// 灵宠的程序动画 → Unity 动画片段数据（native-anim.json，与 bake-native-anims.mjs 同一格式，下游 NativeClipBuilder / CreatureRig 不改）。
//
//   node --import ./scripts/unity/register.mjs scripts/unity/bake-pet-anims.mjs                      全部 8 只（发布 GLB → Unity 目录）
//   node --import ./scripts/unity/register.mjs scripts/unity/bake-pet-anims.mjs dangkang zheng        指定几只（SK_Pet_X / x / 中文名）
//   ... bake-pet-anims.mjs huan --from-export                       发布前：用最新的构建导出 art/source/characters/<ID>/04_export/<ID>_native_vNNN.glb
//   ... bake-pet-anims.mjs huan --from-export --out art/source/pets/_animtest      写到草稿目录（<目录>/<ID>.native-anim.json）
//   ... bake-pet-anims.mjs huan --from-rig [rig.json] --out <目录>  只有骨骼表（creature_rigs/<ID>.json）时预览
//   ... bake-pet-anims.mjs huan --skeleton SK_Enemy_FireRat --out <目录>   测试：用别的已发布资产的骨架跑灵宠的动作表
//   ... bake-pet-anims.mjs --check <file.native-anim.json> ...      只打印校验报告
//
// 灵宠没有 Three.js 代码，这里按「体型模块（四足 / 鸟 / 龙）× 每只灵宠的参数表」直接生成：语义骨骼名
// （docs/pet-system.md 7.3 节约定）→ NativePose（绕模型空间轴转动、两骨 IK）→ 逐帧采样模型空间姿势。
// 规则：循环片段严格周期（所有频率都是循环长度的整数倍，含收尾帧）；步态的步幅 × 频率 / 支撑比 = 记录的 speed
// （CreatureRig 的脚锁才不会和片段打架）；支撑脚在静止踝高；没有 Hit；片段名不带下划线；招式不循环、回 Locomotion。
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import * as THREE from 'three';
import {
  rootPath, Skeleton, skeletonFromGlb, skeletonFromRigJson, latestExport, loadManifest,
  recordClip, sampleFrame, validateDoc, printReport,
} from './pet-anim-lib.mjs';

const FPS = 60; // 鸟扇翅 5–7 Hz：30 fps 每拍只有 4–6 个采样，曲线会走样
const TAU = Math.PI * 2;
const AX = new THREE.Vector3(1, 0, 0); // 绕 +X 正转 = 低头 / 肢体向后摆 / 朝后的尾巴抬起
const AY = new THREE.Vector3(0, 1, 0);
const AZ = new THREE.Vector3(0, 0, 1); // 左翼绕 +Z 正转 = 抬起
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (x) => { x = clamp01(x); return x * x * (3 - 2 * x); };
const frac = (x) => x - Math.floor(x);
/** 关键帧轨：[[t, v], ...]（秒），相邻关键帧之间 smoothstep 插值，两端外保持 */
const K = (...keys) => (t) => {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1] = keys[i];
    if (t <= t1) { const [t0, v0] = keys[i - 1]; return v0 + (v1 - v0) * smooth((t - t0) / Math.max(1e-6, t1 - t0)); }
  }
  return keys[keys.length - 1][1];
};
/** 周期鼓包（u ∈ [0,1) 上以 u0 为中心、宽 w 的高斯，跨接缝连续） */
const pbump = (u, u0, w) => { const d = frac(u - u0 + 0.5) - 0.5; return Math.exp(-((d / w) ** 2)); };
const bump = (t, t0, w) => Math.exp(-(((t - t0) / w) ** 2));

/** 通道合并：数值相加；legs 按腿合并；函数通道（尾巴、鬃毛）返回值逐项相加 */
function merge(a, b) {
  const c = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (k === 'legs') {
      c.legs = { ...(a.legs ?? {}) };
      for (const [lk, lv] of Object.entries(v)) {
        const o = { ...(c.legs[lk] ?? {}) };
        for (const [f, x] of Object.entries(lv)) o[f] = (o[f] ?? 0) + x;
        c.legs[lk] = o;
      }
    } else if (typeof v === 'function') {
      const f0 = a[k];
      c[k] = f0 ? (...args) => { const x = f0(...args), y = v(...args); return x.map((q, i) => q + (y[i] ?? 0)); } : v;
    } else c[k] = (a[k] ?? 0) + v;
  }
  return c;
}

const byDepth = (sk) => (a, b) => sk.depth(a) - sk.depth(b);

/** 尾巴：tail_1..n / tailA_1.. / tail_C1..（Qingniao）按字母分组；fan = 按尾尖左右排位归一到 [-1, 1]（+1 = 生物左） */
function tailChains(sk) {
  const groups = new Map();
  for (const n of sk.names) {
    const m = /^tail_?([A-Za-z]?)_?(\d+)$/.exec(n);
    if (!m) continue;
    const k = m[1].toUpperCase();
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push({ n, i: Number(m[2]) });
  }
  const chains = [...groups.values()].map((l) => l.sort((a, b) => a.i - b.i).map((x) => x.n));
  const tipX = (c) => sk.rest(c[c.length - 1]).x;
  chains.sort((a, b) => tipX(b) - tipX(a) || a[0].localeCompare(b[0]));
  const K = chains.length;
  return chains.map((bones, k) => ({ bones, k, fan: K > 1 ? 1 - (2 * k) / (K - 1) : 0 }));
}

/** 名字族的链根（父骨骼不属于同一族），如 mane_1 / beard_1 / crest_1 / ear_L */
function familyRoots(sk, re) {
  return sk.names.filter((n) => re.test(n) && !re.test(sk.parent(n) ?? ''));
}

function poseTails(P, tails, fn) {
  if (!fn) return;
  for (const ch of tails) {
    const n = ch.bones.length;
    ch.bones.forEach((b, j) => {
      const [ax, ay] = fn(ch.k, ch.fan, j, n, tails.length);
      if (ax) P.rotate(b, AX, ax);
      if (ay) P.rotate(b, AY, ay);
    });
  }
}

// ═════════════════════════ 四足 ═════════════════════════

const PATTERNS = {
  // 触地时刻（步态周期内的相位）
  walk: { HL: 0, FL: 0.25, HR: 0.5, FR: 0.75 }, // 侧序四拍
  trot: { FL: 0, HR: 0, FR: 0.5, HL: 0.5 }, // 对角两拍
  canter: { HL: 0, HR: 0.28, FL: 0.3, FR: 0.55 }, // 三拍：后左 → 后右 + 前左 → 前右（右领）
  gallop: { HL: 0, HR: 0.1, FL: 0.5, FR: 0.6 }, // 横向跑步：后一对 → 半周期后前一对（同 Huodou）
  bound: { HL: 0, HR: 0.04, FL: 0.5, FR: 0.54 }, // 猫科半跳跃
};

function buildQuad(sk) {
  const legs = [];
  for (const end of sk.find(/^(paw|foot|fhoof|hhoof)_[LR]$/)) {
    const mid = sk.parent(end), upper = mid && sk.parent(mid);
    if (!upper || /^(hips|pelvis|root)$/i.test(upper) || /^(hips|pelvis|root)$/i.test(mid)) continue;
    const anc = [mid, upper, sk.parent(upper)].filter(Boolean);
    const front = anc.some((n) => /^(upperarm|forearm|arm|fcannon)/i.test(n)) ? true
      : anc.some((n) => /^(thigh|shin|hcannon)/i.test(n)) ? false : /^(paw|fhoof)/.test(end);
    const side = end.endsWith('_L') ? 1 : -1;
    const U = sk.rest(upper), M = sk.rest(mid), E = sk.rest(end);
    const len = U.distanceTo(M) + M.distanceTo(E);
    const bend = new THREE.Vector3().subVectors(U, M).angleTo(new THREE.Vector3().subVectors(E, M));
    // 绑定姿势腿笔直：IK 找不到弯曲平面，先按生理方向弯一点（前腿肘向后、后腿膝向前）
    const prebend = bend > Math.PI * 0.975 ? (front ? -0.08 : 0.08) : 0;
    legs.push({ key: (front ? 'F' : 'H') + (side > 0 ? 'L' : 'R'), front, side, upper, mid, end, U, M, E, len, prebend });
  }
  const keys = legs.map((l) => l.key).sort().join(',');
  if (keys !== 'FL,FR,HL,HR') throw new Error(`四足：腿识别为 [${keys}]（${legs.map((l) => `${l.upper}→${l.mid}→${l.end}`).join('; ')}）`);
  const L = legs.reduce((s, l) => s + l.len, 0) / legs.length;
  const has = (n) => (sk.has(n) ? n : null);
  const Q = {
    sk, P: sk.P, legs, L,
    hips: has('hips') ?? has('pelvis'),
    spine: sk.find(/^spine\d?$/).sort(byDepth(sk)),
    chest: has('chest'),
    neck: sk.find(/^neck(_?\d+)?$/).sort(byDepth(sk)),
    head: has('head'),
    jaw: has('jaw'),
    ears: familyRoots(sk, /^ear/).map((n) => ({ n, side: /_L(_|\d|$)/.test(n) ? 1 : -1 })),
    tails: tailChains(sk),
    fur: familyRoots(sk, /^(mane|beard|crest|whisker)/),
    bells: familyRoots(sk, /^bell/),
  };
  Q.missing = ['hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'ear_L', 'ear_R']
    .filter((n) => (n === 'neck' ? Q.neck.length === 0 : n === 'spine' ? Q.spine.length === 0 : !sk.has(n)));
  if (!Q.tails.length) Q.missing.push('tail');
  return Q;
}

const _tgt = new THREE.Vector3(), _up = new THREE.Vector3();
const NOLEG = {};

/**
 * 四足姿势（每帧先 reset）。通道：y / z 骨盆平移（腿长倍数）、pitch（+ 低头）/ roll / yaw，flex 脊柱弓起（分摊到 spine*），
 * chest，neck / neckYaw（分摊到颈链），head / headYaw / headRoll，jaw，earL / earR（向外抖）、earBack，
 * tail(k, fan, j, n) → [ax, ay]，fur（鬃 / 须），bell；legs[FL|FR|HL|HR] = { dx, dy, dz（相对静止落点，腿长倍数，dx 向外为正），
 * free（0–1：改为相对肩 / 髋的落点 fx/fy/fz）, curl（脚掌绕 X 翻）, sz（肩 / 髋关节前后滑动）}。腿一律两骨 IK、脚掌回绑定朝向。
 */
function poseQuad(Q, c) {
  const { P, L } = Q;
  P.reset();
  for (const lg of Q.legs) if (lg.prebend) P.rotate(lg.mid, AX, lg.prebend);
  for (const lg of Q.legs) { const sz = c.legs?.[lg.key]?.sz; if (sz) P.translate(lg.upper, 0, 0, sz * L); }
  if (Q.hips) {
    P.translate(Q.hips, 0, (c.y ?? 0) * L, (c.z ?? 0) * L);
    P.rotate(Q.hips, AY, c.yaw ?? 0);
    P.rotate(Q.hips, AX, c.pitch ?? 0);
    P.rotate(Q.hips, AZ, c.roll ?? 0);
  }
  const ns = Q.spine.length;
  for (const b of Q.spine) { P.rotate(b, AX, (c.flex ?? 0) / ns); P.rotate(b, AY, (c.twist ?? 0) / ns); }
  if (Q.chest) { P.rotate(Q.chest, AX, (c.chest ?? 0) + (ns ? 0 : c.flex ?? 0)); P.rotate(Q.chest, AY, c.chestYaw ?? 0); }
  const nn = Q.neck.length;
  for (const b of Q.neck) { P.rotate(b, AX, (c.neck ?? 0) / nn); P.rotate(b, AY, (c.neckYaw ?? 0) / nn); }
  if (Q.head) {
    P.rotate(Q.head, AX, (c.head ?? 0) + (nn ? 0 : c.neck ?? 0));
    P.rotate(Q.head, AY, (c.headYaw ?? 0) + (nn ? 0 : c.neckYaw ?? 0));
    P.rotate(Q.head, AZ, c.headRoll ?? 0);
  }
  if (Q.jaw) P.rotate(Q.jaw, AX, c.jaw ?? 0);
  for (const e of Q.ears) {
    P.rotate(e.n, AZ, -e.side * ((e.side > 0 ? c.earL : c.earR) ?? 0));
    P.rotate(e.n, AX, -(c.earBack ?? 0));
  }
  poseTails(P, Q.tails, c.tail);
  for (const f of Q.fur) {
    const [ax, ay] = c.fur ? c.fur(f) : [0, 0];
    P.rotate(f, AX, ax); P.rotate(f, AY, ay);
  }
  for (const b of Q.bells) P.rotate(b, AX, c.bell ?? 0);
  for (const lg of Q.legs) {
    const lc = c.legs?.[lg.key] ?? NOLEG;
    _tgt.set(lg.E.x + lg.side * (lc.dx ?? 0) * L, lg.E.y + (lc.dy ?? 0) * L, lg.E.z + (lc.dz ?? 0) * L);
    const free = clamp01(lc.free ?? 0);
    if (free > 0) {
      P.hostPosition(lg.upper, _up);
      _up.x += lg.E.x - lg.U.x + lg.side * (lc.fx ?? 0) * L;
      _up.y += (lc.fy ?? -0.6) * L;
      _up.z += (lc.fz ?? 0) * L;
      _tgt.lerp(_up, free);
    }
    P.twoBoneIK(lg.upper, lg.mid, lg.end, _tgt, 1);
    // 只统计落在地面上的脚（支撑脚）：抬起挥爪够不着无所谓，支撑脚够不着 = 悬空 / 滑步
    if (free < 0.01 && _tgt.y - lg.E.y < 0.02 * L) Q.ikMiss = Math.max(Q.ikMiss ?? 0, P.hostPosition(lg.end, _up).distanceTo(_tgt));
    if (lc.curl) P.rotateCurrent(lg.end, AX, lc.curl);
  }
}

/** 待机：呼吸、重心轻晃、环顾、耳朵抖、尾巴摆；四脚钉在静止落点。I = spec.idle */
function quadIdleCh(Q, I, t) {
  const u = t / I.period;
  const br = Math.sin(TAU * I.breaths * u);
  const look = I.look ?? 1;
  const c = {
    // 绑定姿势的前腿往往几乎伸直（肩到蹄 ≈ 0.99 腿长）：待机整体压低 2.5% 腿长，呼吸起伏时腿才够得着地
    y: -0.025 + 0.01 * br * (I.breathe ?? 1),
    chest: -0.025 * br * (I.breathe ?? 1),
    roll: 0.012 * Math.sin(TAU * u),
    yaw: 0.01 * Math.sin(TAU * u + 1),
    neck: 0.03 * Math.sin(TAU * u + 0.6) - 0.012 * br,
    neckYaw: 0.16 * look * Math.sin(TAU * u),
    head: 0.04 * Math.sin(TAU * 2 * u + 1.2),
    headYaw: 0.12 * look * Math.sin(TAU * u - 0.5),
    headRoll: 0.04 * look * Math.sin(TAU * u + 2),
    earL: 0.35 * pbump(u, 0.31, 0.02),
    earR: 0.35 * pbump(u, 0.72, 0.02) + 0.25 * pbump(u, 0.77, 0.015),
    fur: () => [(I.mane ?? 0.03) * br, (I.furSway ?? 0.02) * Math.sin(TAU * u + 0.8)],
    bell: 0.05 * Math.sin(TAU * 2 * u),
    tail: (k, fan, j, n) => [
      (j === 0 ? I.tailLift ?? 0 : 0) + 0.04 / n * Math.sin(TAU * I.tailCycles * u - 0.6 * j + 1 + k),
      (I.tailSway ?? 0.3) / n * Math.sin(TAU * I.tailCycles * u - 0.7 * j + k * (I.tailPhase ?? 0)),
    ],
  };
  return I.extra ? merge(c, I.extra(u, t)) : c;
}

/**
 * 步态：每条腿一个触地相位；支撑段脚从前往后匀速扫过步幅 S（速度 = S·f / 支撑比），腾空段抬脚前摆、脚掌翻起。
 * 前腿的肩关节跟着脚前后滑一点（肩胛骨的滑动，≤ 0.1 腿长），步幅中心在静止落点与肩 / 髋正下方之间。
 * 步幅受腿长限制：逐相位检查支撑脚到肩 / 髋的距离（含身体起伏、肩滑动）≤ 0.975 腿长；不够时先提步频、再压低身体，
 * 最后才降低记录速度（写进 notes）。
 */
function quadGait(Q, spec, g) {
  const pat = PATTERNS[g.gait];
  const duty = g.duty, L = Q.L, bounce = g.bounce ?? 0;
  const twoBeat = g.gait === 'trot' || g.gait === 'walk';
  const hindTD = twoBeat ? pat.HL : (pat.HL + pat.HR) / 2;
  const hindMid = hindTD + duty / 2;
  const center = Object.fromEntries(Q.legs.map((lg) => [lg.key, (lg.U.z - lg.E.z) * (g.center ?? 0.6)]));
  const slideK = g.slide ?? 0.35, slideMax = 0.1 * L;
  const slideOf = (lg, dz) => (lg.front ? Math.max(-slideMax, Math.min(slideMax, slideK * dz)) : 0);
  const yAt = (u0, y0) => y0 - bounce * Math.cos(2 * TAU * (u0 - hindMid));
  const feasible = (S, y0) => {
    for (const lg of Q.legs) {
      for (let i = 0; i <= 10; i++) {
        const us = (i / 10) * duty;
        const dz = S * (0.5 - us / duty);
        const fz = lg.E.z + center[lg.key] + dz - (lg.U.z + slideOf(lg, dz));
        const fy = lg.E.y - (lg.U.y + yAt(frac(us + pat[lg.key]), y0) * L);
        if (Math.hypot(lg.E.x - lg.U.x, fy, fz) > 0.975 * lg.len) return false;
      }
    }
    return true;
  };
  const Smax = (y0) => {
    if (!feasible(0, y0)) return 0;
    let lo = 0, hi = 2.5 * L;
    for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (feasible(m, y0)) lo = m; else hi = m; }
    return lo;
  };
  const lift = (g.lift ?? 0.2) * L;
  const flexA = g.flex ?? 0;
  /** 步态周期相位 u0 ∈ [0,1) 的姿势通道（步幅 S 米、身体压低 y0 腿长） */
  const chan = (u0, S, y0) => {
    const flex = flexA * Math.cos(TAU * (u0 - hindTD + 0.03));
    const bob = Math.cos(2 * TAU * (u0 - hindMid));
    const sway = Math.sin(TAU * (u0 - pat.HL));
    const c = {
      y: yAt(u0, y0),
      pitch: -0.45 * flex + (g.pitch ?? 0),
      flex,
      roll: (twoBeat ? 0.025 : 0.01) * sway,
      yaw: (twoBeat ? 0.02 : 0.008) * Math.sin(TAU * (u0 - pat.HL) + 0.8),
      neck: -0.4 * flex - (g.pitch ?? 0) * 0.5 + 0.04 * bob * (g.nod ?? 1) + (g.neck ?? 0),
      head: -0.15 * flex + 0.02 * bob,
      earBack: g.earBack ?? 0,
      fur: () => [0.06 * bob, 0],
      bell: 0.12 * Math.sin(TAU * u0 + 0.5),
      tail: (k, fan, j, n) => [
        (j === 0 ? g.tailLift ?? 0 : 0) + 0.08 / n * Math.cos(TAU * u0 - 0.6 * j + 0.3 * k) + (j === 0 ? 0.15 * fan * (g.tailFan ?? 0) : 0),
        (g.tailSway ?? 0.2) / n * Math.sin(TAU * u0 - 0.8 * j + k * 0.9) + (j === 0 ? 0.2 * fan * (g.tailFan ?? 0) : 0),
      ],
      legs: {},
    };
    for (const lg of Q.legs) {
      const u = frac(u0 + 1 - pat[lg.key]);
      let dz, dy = 0, curl = 0;
      if (u < duty) dz = S * (0.5 - u / duty);
      else {
        const s = (u - duty) / (1 - duty);
        // 前摆：smoothstep 加 Hermite 切线 = 支撑段速度的 0.8 倍——抬脚 / 落脚瞬间脚在世界里几乎不动
        // （抬起后先继续往后带、落地前回收），CreatureRig 判支撑的那几帧不会被拖着滑
        // 切线上限 1.2·S：再大前摆会先往后甩出步幅之外（低支撑比时），腿伸不到、膝盖一帧翻过去
        const m = -Math.min((0.8 * S * (1 - duty)) / duty, 1.2 * S);
        dz = S * (-0.5 + smooth(s)) + m * s * (1 - s) * (1 - 2 * s);
        const sn = Math.sin(Math.PI * s);
        dy = lift * Math.pow(sn, 0.5);
        curl = (lg.front ? 0.9 : 0.5) * sn * (g.curl ?? 1);
      }
      c.legs[lg.key] = { dz: (dz + center[lg.key]) / L, dy: dy / L, curl, sz: slideOf(lg, dz) / L };
    }
    return c;
  };
  // 实际摆一遍整个周期：支撑脚 IK 是否都够得着（含脊柱屈伸、骨盆俯仰这些几何估算没算进去的）
  const reachable = (S, y0) => {
    Q.ikMiss = 0;
    for (let i = 0; i < 24; i++) poseQuad(Q, chan(i / 24, S, y0));
    const ok = Q.ikMiss < 0.0015;
    Q.ikMiss = 0;
    return ok;
  };
  const need = (f) => (g.speed * duty) / f;
  const fmax = g.fmax ?? g.freq, y0min = g.y0min ?? -0.15;
  let y0 = g.y0 ?? 0, S = Smax(y0);
  while (need(fmax) > S && y0 > y0min) { y0 = Math.max(y0min, y0 - 0.005); S = Smax(y0); }
  if (!reachable(S, y0)) {
    let lo = 0, hi = S;
    for (let i = 0; i < 14; i++) { const m = (lo + hi) / 2; if (reachable(m, y0)) lo = m; else hi = m; }
    S = lo;
  }
  let f = Math.min(fmax, Math.max(g.freq, (g.speed * duty) / Math.max(1e-6, S)));
  const N = Math.max(8, Math.round(FPS / f));
  f = FPS / N;
  S = Math.min(S, need(f));
  const speed = (S * f) / duty;
  const note = `${g.gait} f=${f.toFixed(2)}Hz 支撑比=${duty} 步幅=${(S * 100).toFixed(1)}cm（${(S / L).toFixed(2)} 腿长）`
    + ` 身体压低 ${(-y0 * 100).toFixed(1)}% 腿长 → ${speed.toFixed(2)} m/s${speed < g.speed * 0.98 ? `（目标 ${g.speed}，腿长不够）` : ''}`;
  return { dur: N / FPS, speed, pose: (t) => chan(frac(t * f), S, y0), note };
}

// ═════════════════════════ 鸟 ═════════════════════════

function buildBird(sk) {
  const W = {};
  for (const s of ['L', 'R']) W[s] = [1, 2, 3].map((i) => `wing_${i}_${s}`);
  const missingWing = [...W.L, ...W.R].filter((n) => !sk.has(n));
  if (missingWing.length) throw new Error(`鸟：缺翅膀骨骼 ${missingWing.join(',')}`);
  const legs = ['L', 'R'].map((s) => ({
    thigh: `thigh_${s}`, shin: `shin_${s}`, end: [`talon_${s}`, `foot_${s}`, `claw_${s}`].find((n) => sk.has(n)) ?? `talon_${s}`,
  }));
  const tipX = Math.max(...[...W.L, ...W.R].map((n) => Math.abs(sk.rest(n).x)));
  const size = tipX + sk.rest(W.L[2]).distanceTo(sk.rest(W.L[1]));
  const has = (n) => (sk.has(n) ? n : null);
  const B = {
    sk, P: sk.P, W, legs, size,
    hips: has('hips'), chest: has('chest'),
    neck: sk.find(/^neck(_?\d+)?$/).sort(byDepth(sk)),
    head: has('head'), jaw: has('jaw') ?? has('beak'),
    tails: tailChains(sk),
    crest: familyRoots(sk, /^(crest|feather)/),
  };
  B.missing = ['hips', 'chest', 'neck', 'head', 'jaw', 'thigh_L', 'shin_L', 'talon_L']
    .filter((n) => (n === 'neck' ? B.neck.length === 0 : n === 'jaw' ? !B.jaw : !sk.has(n)));
  if (!B.tails.length) B.missing.push('tail');
  return B;
}

/** 三节翅膀拍动（同 Qingniao.poseNative）：phase、amp 振幅、raise 整体上举、sweep 后掠、fold 收翅；上扬段半收后掠 */
function poseWings(P, W, c) {
  const ph = c.phase ?? 0, amp = c.amp ?? 0, raise = c.raise ?? 0, sweep = c.sweep ?? 0, fold = c.fold ?? 0;
  const up = Math.max(0, Math.cos(ph)) * amp;
  for (const [side, s] of [['L', 1], ['R', -1]]) {
    const [w1, w2, w3] = W[side];
    P.rotate(w1, AZ, s * (amp * Math.sin(ph) + raise - fold));
    P.rotate(w1, AY, s * (sweep * 0.7 + up * 0.25 + fold * 0.7));
    P.rotate(w2, AZ, s * (amp * 0.45 * Math.sin(ph - 0.7) + raise * 0.3));
    P.rotate(w2, AY, s * (sweep * 0.45 + up * 0.35 - fold * 1.0));
    P.rotate(w3, AZ, s * (amp * 0.35 * Math.sin(ph - 1.3) + raise * 0.2));
    P.rotate(w3, AY, s * (sweep * 0.3 + up * 0.25 + fold * 0.9));
  }
}

/** 鸟姿势：y / z（翼展半宽倍数）、pitch（+ 低头）、roll，chest，翅膀（见 poseWings），tuck 收腿、grip 握爪，颈 / 头 / 喙，尾、冠 */
function poseBird(B, c) {
  const { P, size } = B;
  P.reset();
  if (B.hips) {
    P.translate(B.hips, 0, (c.y ?? 0) * size, (c.z ?? 0) * size);
    P.rotate(B.hips, AX, c.pitch ?? 0);
    P.rotate(B.hips, AZ, c.roll ?? 0);
  }
  if (B.chest) P.rotate(B.chest, AX, c.chest ?? 0);
  poseWings(P, B.W, c);
  for (const l of B.legs) {
    P.rotate(l.thigh, AX, 0.95 * (c.tuck ?? 0) + (c.legSwing ?? 0));
    P.rotate(l.shin, AX, -0.5 * (c.tuck ?? 0));
    P.rotate(l.end, AX, 0.7 * (c.tuck ?? 0) + (c.grip ?? 0));
  }
  const nn = B.neck.length;
  for (const b of B.neck) { P.rotate(b, AX, (c.neck ?? 0) / nn); P.rotate(b, AY, (c.neckYaw ?? 0) / nn); }
  if (B.head) {
    P.rotate(B.head, AX, (c.head ?? 0) + (nn ? 0 : c.neck ?? 0));
    P.rotate(B.head, AY, (c.headYaw ?? 0) + (nn ? 0 : c.neckYaw ?? 0));
    P.rotate(B.head, AZ, c.headRoll ?? 0);
  }
  if (B.jaw) P.rotate(B.jaw, AX, c.jaw ?? 0);
  poseTails(P, B.tails, c.tail);
  for (const b of B.crest) P.rotate(b, AX, c.crest ?? 0);
}

/** 悬停待机：pitch 抬头（身体半立）、拍翅带动身体上下、腿半收、环顾、尾巴慢摆。flapHz × period 必须是整数 */
function birdIdleCh(B, I, t) {
  const u = t / I.period;
  const ph = TAU * I.flapHz * t;
  const look = I.look ?? 1;
  const c = {
    phase: ph, amp: I.amp, raise: I.raise ?? 0.1, sweep: I.sweep ?? 0.05,
    pitch: I.pitch, y: -(I.bob ?? 0.03) * Math.sin(ph - 0.4), tuck: I.tuck ?? 0.4, grip: 0.3,
    neck: -I.pitch * 0.5 + 0.04 * Math.sin(TAU * u + 1),
    head: -I.pitch * 0.4 + 0.05 * Math.sin(TAU * 2 * u) + 0.015 * Math.sin(ph),
    neckYaw: 0.15 * look * Math.sin(TAU * u - 0.4),
    headYaw: 0.3 * look * Math.sin(TAU * u),
    headRoll: 0.08 * look * Math.sin(TAU * u + 1.5),
    crest: 0.04 * Math.sin(ph),
    tail: (k, fan, j, n) => [
      (I.tailPitch ?? 0) / n + 0.05 / n * Math.sin(ph - 0.6 * j) + 0.04 / n * Math.sin(TAU * (I.tailCycles ?? 1) * u - 0.8 * j),
      (I.tailSway ?? 0.2) / n * Math.sin(TAU * (I.tailCycles ?? 1) * u - 0.7 * j + k) + (j === 0 ? 0.08 * fan : 0),
    ],
  };
  return c;
}

/** 前飞：低头、拍得更快更大、略后掠、腿全收、颈部抵消身体前倾（视线水平）、尾羽顺着气流 */
function birdGait(B, spec, g) {
  const cycles = Math.round(g.flapHz * g.period);
  if (Math.abs(cycles - g.flapHz * g.period) > 1e-6) throw new Error(`${spec.key}: flapHz × period 不是整数`);
  const pose = (t) => {
    const u = t / g.period, ph = TAU * g.flapHz * t;
    return {
      phase: ph, amp: g.amp, raise: g.raise ?? 0.05, sweep: g.sweep ?? 0.15,
      pitch: g.pitch, y: -(g.bob ?? 0.03) * Math.sin(ph - 0.4), tuck: 1, grip: 0.5,
      neck: -g.pitch * 0.7, head: -g.pitch * 0.3 + 0.015 * Math.sin(ph),
      headYaw: 0.06 * Math.sin(TAU * u), crest: -0.15 + 0.05 * Math.sin(ph),
      tail: (k, fan, j, n) => [
        (g.tailPitch ?? 0) / n + 0.04 / n * Math.sin(ph - 0.7 * j),
        0.1 / n * Math.sin(TAU * u - 0.7 * j + k) + (j === 0 ? 0.05 * fan : 0),
      ],
    };
  };
  return { dur: g.period, speed: g.speed, pose, note: `飞行 拍翅 ${g.flapHz}Hz 俯 ${g.pitch} → ${g.speed} m/s（无脚步 IK，按玩法速度记录）` };
}

// ═════════════════════════ 龙 ═════════════════════════

function buildDragon(sk) {
  const has = (n) => (sk.has(n) ? n : null);
  const hips = has('hips');
  if (!hips || !sk.has('head')) throw new Error('龙：缺 hips / head');
  const fwd = [];
  for (let n = 'head'; n && n !== hips; n = sk.parent(n)) fwd.unshift(n);
  if (sk.parent(fwd[0]) !== hips) throw new Error('龙：head 不在 hips 之下');
  const tails = tailChains(sk);
  const tail = tails.find((c) => sk.parent(c.bones[0]) === hips)?.bones ?? tails[0]?.bones ?? [];
  // 身体弧长坐标 s：头 0 → 尾尖 1
  const pts = [...[...fwd].reverse(), hips, ...tail].map((n) => ({ n, p: sk.rest(n) }));
  let acc = 0;
  const s = new Map();
  pts.forEach((x, i) => { if (i) acc += x.p.distanceTo(pts[i - 1].p); s.set(x.n, acc); });
  const tailTip = tail.length > 1 ? sk.rest(tail[tail.length - 1]).distanceTo(sk.rest(tail[tail.length - 2])) : 0;
  const total = acc + tailTip;
  for (const [k, v] of s) s.set(k, v / total);
  const W = {};
  for (const sd of ['L', 'R']) W[sd] = [1, 2, 3].map((i) => `wing_${i}_${sd}`);
  const D = {
    sk, P: sk.P, hips, fwd, tail, s, size: total, W,
    neck: fwd.filter((n) => /^neck/.test(n)),
    chest: has('chest'), jaw: has('jaw'),
    front: ['L', 'R'].map((sd) => ({ u: `upperarm_${sd}`, l: `forearm_${sd}`, e: `claw_${sd}` })),
    hind: ['L', 'R'].map((sd) => ({ u: `thigh_${sd}`, l: `shin_${sd}`, e: `hclaw_${sd}` })),
    fur: familyRoots(sk, /^(mane|beard|whisker|crest)/),
  };
  const want = ['spine1', 'spine2', 'chest', 'neck_1', 'neck_2', 'jaw', ...[1, 2, 3, 4, 5, 6].map((i) => `tail_${i}`),
    ...[...W.L, ...W.R], 'upperarm_L', 'forearm_L', 'claw_L', 'thigh_L', 'shin_L', 'hclaw_L'];
  D.missing = want.filter((n) => !sk.has(n));
  return D;
}

/**
 * 龙姿势：身体是一道从头传到尾的弯曲波（每节局部弯角 κ = A·sin(相位 − 2π·s/λ)；头这一侧的链绕 X 取 −κ、尾这一侧取 +κ，
 * 同号 = 同一个方向的弧），头按前面各节累计的弯角反向补偿（视线稳定）；翅膀同鸟；腿飞行时收起。
 */
function poseDragon(D, c) {
  const { P } = D;
  P.reset();
  const lam = c.lambda ?? 1;
  const kv = (n) => (c.waveV ?? 0) * Math.sin((c.wavePhase ?? 0) - (TAU * D.s.get(n)) / lam);
  const kl = (n) => (c.waveL ?? 0) * Math.sin((c.wavePhase ?? 0) + 1.3 - (TAU * D.s.get(n)) / lam);
  // 各节的弯角（头侧链 −κ、尾侧链 +κ），以及每节骨段相对 hips 的累计转角；hips 反向转「全身平均转角」，
  // 波就绕一条稳定的身体中线传过去，而不是整条龙绕 hips 跷跷板
  const fb = D.fwd.filter((n) => n !== 'head').map((n) => [n, -kv(n), kl(n)]);
  const tb = D.tail.map((n) => [n, kv(n), -kl(n)]);
  let sumV = 0, sumL = 0, cnt = 0;
  for (const chain of [fb, tb]) {
    let av = 0, al = 0;
    for (const [, v, l] of chain) { av += v; al += l; sumV += av; sumL += al; cnt++; }
  }
  const compV = cnt ? -sumV / cnt : 0, compL = cnt ? -sumL / cnt : 0;
  P.translate(D.hips, 0, (c.y ?? 0) * D.size, 0);
  P.rotate(D.hips, AY, (c.yaw ?? 0) + compL);
  P.rotate(D.hips, AX, (c.pitch ?? 0) + compV);
  P.rotate(D.hips, AZ, c.roll ?? 0);
  let accV = compV, accL = compL;
  for (const [n, v, l] of fb) { accV += v; accL += l; P.rotate(n, AX, v); P.rotate(n, AY, l); }
  // 头：按头侧累计的弯角反向补偿（视线稳定）
  P.rotate('head', AX, -accV * (c.headStab ?? 0.8) + (c.head ?? 0));
  P.rotate('head', AY, -accL * (c.headStab ?? 0.8) + (c.headYaw ?? 0));
  tb.forEach(([n, v, l], j) => {
    P.rotate(n, AX, v + (c.tailDroop ?? 0) / D.tail.length);
    P.rotate(n, AY, l + ((c.tailYaw ?? 0) / D.tail.length) * ((j + 1) / D.tail.length) * 2);
  });
  if (D.chest) P.rotate(D.chest, AX, c.chest ?? 0);
  const nn = D.neck.length;
  D.neck.forEach((n, i) => {
    P.rotate(n, AX, (c.neck ?? 0) / nn + (i === 0 ? c.coil1 ?? 0 : i === nn - 1 ? c.coil2 ?? 0 : 0));
    P.rotate(n, AY, (c.neckYaw ?? 0) / nn);
  });
  if (D.jaw) P.rotate(D.jaw, AX, c.jaw ?? 0);
  poseWings(P, D.W, c);
  const pad = c.paddle ?? 0;
  D.front.forEach((l, i) => {
    P.rotate(l.u, AX, 0.9 * (c.ftuck ?? 0) + pad * (i ? -1 : 1));
    P.rotate(l.l, AX, -1.1 * (c.ftuck ?? 0) + (c.freach ?? 0));
    P.rotate(l.e, AX, c.fclaw ?? 0);
  });
  D.hind.forEach((l, i) => {
    P.rotate(l.u, AX, 1.0 * (c.htuck ?? 0) + pad * 0.6 * (i ? 1 : -1));
    P.rotate(l.l, AX, 0.35 * (c.htuck ?? 0));
    P.rotate(l.e, AX, c.hclaw ?? 0);
  });
  for (const f of D.fur) P.rotate(f, AX, c.fur ?? 0);
}

function dragonIdleCh(D, I, t) {
  const u = t / I.period;
  return {
    wavePhase: TAU * I.waveHz * t, waveV: I.waveV, waveL: I.waveL, lambda: I.lambda,
    phase: TAU * I.flapHz * t, amp: I.amp, raise: I.raise ?? 0.15, sweep: I.sweep ?? 0.05,
    y: -(I.bob ?? 0.01) * Math.sin(TAU * I.flapHz * t - 0.4), pitch: I.pitch ?? 0,
    head: 0.04 * Math.sin(TAU * u + 0.5), headYaw: 0.15 * Math.sin(TAU * u),
    ftuck: 0.7, htuck: 0.8, fclaw: 0.5, hclaw: 0.4, paddle: 0.08 * Math.sin(TAU * I.waveHz * t),
    fur: 0.05 * Math.sin(TAU * I.waveHz * t - 1),
  };
}

function dragonGait(D, spec, g) {
  for (const [hz, what] of [[g.waveHz, 'waveHz'], [g.flapHz, 'flapHz']])
    if (Math.abs(Math.round(hz * g.period) - hz * g.period) > 1e-6) throw new Error(`${spec.key}: ${what} × period 不是整数`);
  const pose = (t) => ({
    wavePhase: TAU * g.waveHz * t, waveV: g.waveV, waveL: g.waveL, lambda: g.lambda,
    phase: TAU * g.flapHz * t, amp: g.amp, raise: g.raise ?? 0.1, sweep: g.sweep ?? 0.15,
    y: -(g.bob ?? 0.012) * Math.sin(TAU * g.flapHz * t - 0.4), pitch: g.pitch,
    head: -g.pitch * 0.8, ftuck: 1, htuck: 1, fclaw: 0.7, hclaw: 0.6, fur: -0.15 + 0.05 * Math.sin(TAU * g.waveHz * t),
  });
  return { dur: g.period, speed: g.speed, pose, note: `飞行 身波 ${g.waveHz}Hz 拍翅 ${g.flapHz}Hz → ${g.speed} m/s（无脚步 IK，按玩法速度记录）` };
}

const PLANS = {
  quadruped: { build: buildQuad, pose: poseQuad, idle: quadIdleCh, gait: quadGait },
  bird: { build: buildBird, pose: poseBird, idle: birdIdleCh, gait: birdGait },
  dragon: { build: buildDragon, pose: poseDragon, idle: dragonIdleCh, gait: dragonGait },
};

// ═════════════════════════ 每只灵宠 ═════════════════════════
// 招式 = 在待机姿势上叠加的增量通道（delta(t)），起止都回到 0（从 Locomotion 进、回 Locomotion）；
// 串连招式（chargeWindup → ram）前一段的末姿势 = 后一段的首姿势。腿：legs[FL|FR|HL|HR]，单位腿长。

/** 前爪一挥：抬到前上方（dz, dy）→ 落下挥过 → 回到落点。返回 [dz, dy, curl] 三条轨 */
function swipe(t0, tStrike, tEnd, reach = 0.4, high = 0.45) {
  const dz = K([t0, 0], [t0 + (tStrike - t0) * 0.55, reach * 0.8], [tStrike, reach], [tStrike + (tEnd - tStrike) * 0.45, reach * 0.35], [tEnd, 0]);
  const dy = K([t0, 0], [t0 + (tStrike - t0) * 0.55, high], [tStrike, 0.1], [tStrike + (tEnd - tStrike) * 0.45, 0.12], [tEnd, 0]);
  const curl = K([t0, 0], [t0 + (tStrike - t0) * 0.55, -0.45], [tStrike, 0.7], [tStrike + (tEnd - tStrike) * 0.5, 0.3], [tEnd, 0]);
  return (t) => ({ dz: dz(t), dy: dy(t), curl: curl(t) });
}

const PETS = {
  SK_Pet_Dangkang: {
    key: 'dangkang', name: '当康', plan: 'quadruped', gameplaySpeed: 9,
    idle: {
      period: 4, breaths: 3, look: 0.8, tailCycles: 8, tailSway: 0.5, tailLift: 0.1,
      // 拱鼻子嗅一嗅（u ≈ 0.55 时连点三下）
      extra: (u) => ({ head: 0.07 * Math.sin(TAU * 12 * u) * pbump(u, 0.55, 0.05), jaw: 0.04 * pbump(u, 0.55, 0.05) }),
    },
    walk: { gait: 'trot', speed: 1.5, freq: 3.2, fmax: 3.8, duty: 0.36, lift: 0.22, bounce: 0.03, y0: -0.04, y0min: -0.1, tailSway: 0.4 },
    // 腿极短：快跑做成腾空很长的蹦跳（支撑比 0.12），否则录制速度只有 ~1.9 m/s，玩法 9 m/s 下 MoveScale 封顶 2.5× 会大幅滑步
    move: { gait: 'bound', speed: 3.8, freq: 4.2, fmax: 4.8, duty: 0.12, lift: 0.34, bounce: 0.08, flex: 0.1, y0: -0.06, tailLift: 0.3 },
    actions: {
      // 刨地蓄力：压低、低头、右前蹄往后刨一下 → 冲撞
      chargeWindup: () => {
        const y = K([0, 0], [0.18, -0.12]), z = K([0, 0], [0.18, -0.06]), pitch = K([0, 0], [0.18, 0.1]);
        const neck = K([0, 0], [0.16, 0.35]), head = K([0, 0], [0.16, 0.25]), tail = K([0, 0], [0.2, 0.35]);
        const dz = K([0, 0], [0.1, 0.22], [0.2, -0.16], [0.27, -0.05], [0.33, 0]), dy = K([0, 0], [0.1, 0.18], [0.16, 0.1], [0.24, 0.1], [0.29, 0.06], [0.33, 0]);
        return {
          dur: 0.35, next: 'ram', events: [],
          delta: (t) => ({ y: y(t), z: z(t), pitch: pitch(t), neck: neck(t), head: head(t), earBack: 0.4 * smooth(t / 0.15),
            tail: (k, fan, j) => [j === 0 ? tail(t) : 0, 0], legs: { FR: { dz: dz(t), dy: dy(t), curl: 0.5 * dy(t) / 0.16 } } }),
        };
      },
      // 冲撞：从蓄力的末姿势起，低头前顶（0.14 s 命中）→ 回正
      ram: () => {
        const y = K([0, -0.12], [0.12, -0.05], [0.4, 0]), z = K([0, -0.06], [0.12, 0.16], [0.4, 0]);
        const pitch = K([0, 0.1], [0.12, 0.2], [0.4, 0]), neck = K([0, 0.35], [0.12, 0.45], [0.4, 0]), head = K([0, 0.25], [0.12, 0.3], [0.4, 0]);
        const tail = K([0, 0.35], [0.4, 0]), ears = K([0, 0.4], [0.4, 0]);
        return {
          dur: 0.4, events: [{ t: 0.14, name: 'hit' }],
          delta: (t) => ({ y: y(t), z: z(t), pitch: pitch(t), neck: neck(t), head: head(t), earBack: ears(t),
            tail: (k, fan, j) => [j === 0 ? tail(t) : 0, 0] }),
        };
      },
      // 拱地：低头到地、鼻子连拱三下（0.15–0.65 s）、尾巴快摇
      dig: () => {
        const e = (t) => smooth(t / 0.15) * (1 - smooth((t - 0.65) / 0.15));
        return {
          dur: 0.8, events: [],
          delta: (t) => {
            const a = e(t), r = Math.sin(TAU * 6 * (t - 0.15)) * (t > 0.15 && t < 0.65 ? 1 : 0);
            return { y: -0.05 * a, pitch: 0.12 * a, neck: (0.6 + 0.12 * r) * a, head: (0.3 + 0.08 * r) * a, headRoll: 0.08 * Math.sin(TAU * 4 * t) * a,
              jaw: 0.1 * a, tail: (k, fan, j, n) => [0, (0.4 / n) * Math.sin(TAU * 8 * t - j) * a] };
          },
        };
      },
    },
  },

  SK_Pet_Huan: {
    key: 'huan', name: '讙', plan: 'quadruped', gameplaySpeed: 10,
    idle: { period: 4, breaths: 2, look: 1, tailCycles: 1, tailSway: 0.45, tailPhase: TAU / 3, tailLift: 0.15 },
    walk: { gait: 'trot', speed: 1.6, freq: 3.4, fmax: 4.4, duty: 0.36, lift: 0.22, bounce: 0.025, y0: -0.04, y0min: -0.1, tailSway: 0.3, tailLift: 0.1 },
    move: { gait: 'bound', speed: 4.2, freq: 3.8, fmax: 5.0, duty: 0.18, lift: 0.3, bounce: 0.06, flex: 0.12, y0: -0.06, tailLift: 0.25, earBack: 0.3 },
    actions: {
      // 两下快爪：左前 0.14 s、右前 0.31 s 命中
      claw: () => {
        const L = swipe(0, 0.14, 0.26), R = swipe(0.17, 0.31, 0.43);
        const lift = K([0, 0], [0.08, 1], [0.37, 1], [0.45, 0]);
        return {
          dur: 0.45, events: [{ t: 0.14, name: 'hit' }, { t: 0.31, name: 'hit' }],
          // 前身只微抬（前腿绑定姿势几乎伸直，抬多了支撑的那只前爪够不着地）
          delta: (t) => ({ pitch: -0.05 * lift(t), y: -0.05 * lift(t), z: 0.03 * lift(t), neck: 0.12 * lift(t), head: -0.05 * lift(t),
            jaw: 0.15 * lift(t), earBack: 0.45 * lift(t), roll: 0.06 * (bump(t, 0.14, 0.06) - bump(t, 0.31, 0.06)),
            legs: { FL: L(t), FR: R(t) } }),
        };
      },
      // 挑衅：弓背、仰头长嚎、三尾炸开
      taunt: () => {
        const e = (t) => smooth(t / 0.2) * (1 - smooth((t - 0.72) / 0.18));
        const yowl = (t) => smooth((t - 0.22) / 0.12) * (1 - smooth((t - 0.62) / 0.12));
        return {
          dur: 0.9, events: [],
          delta: (t) => {
            const a = e(t), w = yowl(t);
            return { flex: 0.35 * a, y: 0.04 * a, pitch: -0.05 * a, neck: -0.35 * w - 0.05 * a, head: -0.3 * w,
              jaw: (0.35 + 0.05 * Math.sin(TAU * 14 * t)) * w, earBack: 0.5 * a,
              tail: (k, fan, j, n) => [j === 0 ? 0.6 * a : 0.1 / n * a, j === 0 ? 0.55 * fan * a : 0.05 * Math.sin(TAU * 10 * t + j) * a] };
          },
        };
      },
    },
  },

  SK_Pet_Jingwei: {
    key: 'jingwei', name: '精卫', plan: 'bird', gameplaySpeed: 13,
    idle: { period: 2, flapHz: 5.5, amp: 0.8, raise: 0.15, pitch: -0.35, tuck: 0.5, bob: 0.04, tailCycles: 1, tailSway: 0.2, tailPitch: 0.1 },
    walk: { period: 1, flapHz: 6, amp: 0.85, pitch: 0.15, sweep: 0.1, speed: 6 },
    move: { period: 1, flapHz: 7, amp: 0.95, pitch: 0.3, sweep: 0.18, speed: 13 },
    actions: {
      // 俯冲投石：0.18 s 压低前冲、0.24 s 张喙（事件 drop）、随后用力拍两下回到悬停
      drop: () => {
        const y = K([0, 0], [0.18, -0.4], [0.3, -0.3], [0.5, 0]), pitch = K([0, 0], [0.15, 0.55], [0.3, 0.25], [0.5, 0]);
        const fold = K([0, 0], [0.12, 0.35], [0.24, 0.1], [0.32, 0]), amp = K([0, 0], [0.12, -0.35], [0.28, 0.25], [0.5, 0]);
        const jaw = K([0, 0], [0.18, 0], [0.23, 0.4], [0.36, 0.4], [0.48, 0]), head = K([0, 0], [0.2, 0.25], [0.5, 0]);
        return { dur: 0.5, events: [{ t: 0.24, name: 'drop' }],
          delta: (t) => ({ y: y(t), pitch: pitch(t), fold: fold(t), amp: amp(t), jaw: jaw(t), head: head(t), neck: -0.3 * pitch(t) }) };
      },
    },
  },

  SK_Pet_Chongming: {
    key: 'chongming', name: '重明鸟', plan: 'bird', gameplaySpeed: 13,
    idle: { period: 2, flapHz: 4, amp: 0.7, raise: 0.12, pitch: -0.3, tuck: 0.5, bob: 0.03, tailCycles: 1, tailSway: 0.35, tailPitch: 0.15 },
    walk: { period: 2, flapHz: 4.5, amp: 0.8, pitch: 0.15, sweep: 0.1, speed: 6, tailPitch: 0.1 },
    move: { period: 1, flapHz: 5, amp: 0.9, pitch: 0.28, sweep: 0.18, speed: 13, tailPitch: 0.15 },
    actions: {
      // 双瞳雷光：展翅上扬定住、头前探（0.32 s 事件 fire）
      gaze: () => {
        const e = K([0, 0], [0.15, 1], [0.45, 1], [0.6, 0]);
        return { dur: 0.6, events: [{ t: 0.32, name: 'fire' }],
          delta: (t) => { const a = e(t); return { raise: 0.5 * a, amp: -0.45 * a, sweep: -0.15 * a, neck: 0.3 * a, head: -0.3 * a, crest: -0.5 * a,
            tail: (k, fan, j) => [0, j === 0 ? 0.35 * fan * a : 0] }; } };
      },
      // 长鸣：仰头、翅膀张满、张喙、尾羽开屏
      cry: () => {
        const e = K([0, 0], [0.2, 1], [0.6, 1], [0.8, 0]), open = K([0, 0], [0.2, 0], [0.28, 1], [0.6, 1], [0.7, 0]);
        return { dur: 0.8, events: [],
          delta: (t) => { const a = e(t); return { neck: -0.5 * a, head: -0.25 * a, raise: 0.35 * a, sweep: -0.25 * a, amp: -0.3 * a,
            jaw: 0.45 * open(t), crest: -0.6 * a, pitch: -0.1 * a, tail: (k, fan, j, n) => [j === 0 ? 0.25 * a : 0, j === 0 ? 0.45 * fan * a : 0] }; } };
      },
    },
  },

  SK_Pet_Suanni: {
    key: 'suanni', name: '狻猊', plan: 'quadruped', gameplaySpeed: 9,
    idle: { period: 4, breaths: 2, breathe: 1.5, look: 0.7, mane: 0.06, tailCycles: 1, tailSway: 0.35, tailLift: 0.05 },
    walk: { gait: 'trot', speed: 1.5, freq: 2.8, fmax: 3.4, duty: 0.42, lift: 0.18, bounce: 0.03, y0: -0.04, y0min: -0.08, nod: 1.5 },
    move: { gait: 'bound', speed: 3.7, freq: 3.8, fmax: 4.4, duty: 0.15, lift: 0.3, bounce: 0.07, flex: 0.08, y0: -0.06, nod: 1.5, tailLift: 0.2 }, // 沉重的腾空蹦跳（快步够不到 3.6 m/s）
    actions: {
      // 吐蚀香：低头前伸、张口，颈部一鼓一鼓（两下）
      breathe: () => {
        const e = K([0, 0], [0.12, 1], [0.48, 1], [0.6, 0]);
        return { dur: 0.6, events: [],
          delta: (t) => { const a = e(t), p = Math.sin(TAU * 2 * t / 0.6); return { z: 0.05 * a, y: -0.02 * a, neck: (0.25 + 0.06 * p) * a, head: -0.18 * a,
            jaw: (0.3 + 0.06 * p) * a, chest: 0.04 * p * a, fur: () => [-0.08 * a, 0] }; } };
      },
      // 狮吼：前身微微立起、仰头（0.38 s 事件 roar）、鬃毛炸开，0.45 s 前爪落地
      roar: () => {
        const rear = K([0, 0], [0.3, 1], [0.42, 0.25], [0.7, 0.2], [0.9, 0]), up = K([0, 0], [0.3, 1], [0.7, 1], [0.9, 0]);
        const jaw = K([0, 0], [0.3, 0.1], [0.38, 0.5], [0.68, 0.45], [0.8, 0]), paw = K([0, 0], [0.28, 1], [0.45, 0]);
        return { dur: 0.9, events: [{ t: 0.38, name: 'roar' }],
          delta: (t) => ({ pitch: -0.18 * rear(t), neck: -0.3 * up(t), head: -0.15 * up(t), jaw: jaw(t),
            fur: () => [-0.25 * up(t), 0], earBack: 0.4 * up(t),
            y: -0.05 * up(t), legs: { FL: { dy: 0.22 * paw(t), dz: 0.1 * paw(t), curl: 0.4 * paw(t) }, FR: { dy: 0.18 * paw(t), dz: 0.08 * paw(t), curl: 0.4 * paw(t) } } }),
        };
      },
    },
  },

  SK_Pet_Zheng: {
    key: 'zheng', name: '狰', plan: 'quadruped', gameplaySpeed: 11,
    idle: {
      period: 4, breaths: 2, look: 1, tailCycles: 1, tailSway: 0.25, tailPhase: 0.4, tailLift: 0.1,
      // 五条尾巴依次慢慢甩一下（每条间隔 0.16 个周期）
      extra: (u) => ({ tail: (k, fan, j, n, K) => {
        const u0 = 0.1 + (0.8 * k) / Math.max(1, K);
        const w = pbump(u, u0 + 0.015 * j, 0.06);
        return [0.12 / n * w, (0.7 / n) * w * Math.sin(TAU * 2 * (u - u0) - 0.5 * j + 1.2)];
      } }),
    },
    walk: { gait: 'trot', speed: 1.8, freq: 3.0, fmax: 3.8, duty: 0.36, lift: 0.22, bounce: 0.025, y0: -0.04, y0min: -0.1, tailSway: 0.25 },
    move: { gait: 'gallop', speed: 4.6, freq: 3.8, fmax: 4.6, duty: 0.16, lift: 0.3, bounce: 0.07, flex: 0.2, y0: -0.06, tailLift: 0.2, tailFan: 0.3 }, // 支撑比压到 0.16，录制速度要 ≥ 11 / 2.5
    actions: {
      // 扑：伏低蓄力（0–0.22 s）→ 弹出（前爪前伸、后腿蹬直、整体腾起）→ 落地回正
      pounce: (R) => {
        const crouch = K([0, 0], [0.2, 1], [0.24, 1], [0.32, 0]), spring = K([0, 0], [0.22, 0], [0.32, 1], [0.38, 1], [0.48, 0]);
        const hop = K([0, 0], [0.24, 0], [0.33, 1], [0.42, 0]);
        return { dur: 0.5, events: [],
          rootY: (t) => 0.12 * R.L * hop(t),
          delta: (t) => { const c = crouch(t), s = spring(t); return {
            y: -0.22 * c + 0.08 * s, z: -0.08 * c + 0.22 * s, pitch: 0.05 * c - 0.15 * s, neck: 0.12 * c - 0.1 * s, head: -0.12 * c,
            earBack: 0.5 * Math.max(c, s), jaw: 0.25 * s,
            tail: (k, fan, j, n) => [j === 0 ? -0.2 * c + 0.3 * s : 0, 0.08 * Math.sin(TAU * 8 * t + k) * c],
            legs: { FL: { free: s, fz: 0.5, fy: -0.5 }, FR: { free: s, fz: 0.45, fy: -0.52 }, HL: { dz: -0.25 * s, dy: 0.12 * s }, HR: { dz: -0.22 * s, dy: 0.12 * s } } }; } };
      },
      // 五尾连抽：五条尾巴依次（间隔 0.07 s）抬起甩出，每次事件 hit
      tailLash: () => {
        const ts = [0, 1, 2, 3, 4].map((i) => 0.12 + 0.07 * i);
        const e = K([0, 0], [0.08, 1], [0.48, 1], [0.6, 0]);
        return { dur: 0.6, events: ts.map((t) => ({ t, name: 'hit' })),
          delta: (t) => { const a = e(t); return { yaw: 0.05 * a * Math.sin(TAU * (t - 0.1) / 0.5), roll: 0.03 * a, y: -0.04 * a, twist: -0.1 * a, headYaw: 0.25 * a, neckYaw: 0.15 * a, earBack: 0.3 * a,
            tail: (k, fan, j, n, Kc) => {
              const tk = ts[Math.min(ts.length - 1, Math.round((k * (ts.length - 1)) / Math.max(1, Kc - 1)))];
              const w = bump(t, tk + 0.012 * j, 0.05);
              return [(j === 0 ? 0.5 * a : 0.06 / n * a) + 0.15 / n * w, (1.1 / n) * w * (fan >= 0 ? 1 : -1) * (j === 0 ? 0.5 : 1)];
            } }; } };
      },
      // 撕裂：前扑半步，左右前爪各一爪（0.16 s / 0.34 s）
      rend: () => {
        const L = swipe(0.02, 0.16, 0.28, 0.5, 0.5), R = swipe(0.2, 0.34, 0.47, 0.5, 0.5);
        const e = K([0, 0], [0.1, 1], [0.4, 1], [0.5, 0]);
        return { dur: 0.5, events: [],
          delta: (t) => { const a = e(t); return { z: 0.05 * a, pitch: -0.04 * a + 0.1 * (bump(t, 0.16, 0.05) + bump(t, 0.34, 0.05)), y: -0.05 * a,
            roll: 0.07 * (bump(t, 0.16, 0.06) - bump(t, 0.34, 0.06)), neck: 0.1 * a, jaw: 0.3 * a, earBack: 0.5 * a, legs: { FL: L(t), FR: R(t) } }; } };
      },
    },
  },

  SK_Pet_Baize: {
    key: 'baize', name: '白泽', plan: 'quadruped', gameplaySpeed: 10,
    idle: { period: 4, breaths: 1, breathe: 1.3, look: 0.6, mane: 0.04, furSway: 0.08, tailCycles: 1, tailSway: 0.3 },
    walk: { gait: 'trot', speed: 1.6, freq: 2.2, fmax: 2.8, duty: 0.42, lift: 0.18, bounce: 0.02, y0: -0.04, y0min: -0.08, nod: 1.5 }, // 从容的慢快步
    move: { gait: 'canter', speed: 4.0, freq: 2.6, fmax: 3.0, duty: 0.24, lift: 0.26, bounce: 0.05, flex: 0.08, y0: -0.06, tailLift: 0.15 },
    actions: {
      // 凝视：昂首、第三只眼瞪视（0.3 s 事件 fire）
      gaze: () => {
        const up = K([0, 0], [0.2, 1], [0.45, 1], [0.6, 0]), glare = K([0, 0], [0.24, 0], [0.3, 1], [0.42, 1], [0.55, 0]);
        return { dur: 0.6, events: [{ t: 0.3, name: 'fire' }],
          delta: (t) => ({ neck: -0.3 * up(t), head: -0.2 * up(t) + 0.12 * glare(t), pitch: -0.03 * up(t), y: -0.03 * up(t), fur: () => [-0.12 * up(t), 0], earBack: 0.2 * up(t) }) };
      },
      // 白泽图：后腿立起、前蹄收在胸前（0.55 s 事件 cast），0.9 s 前蹄落地
      scroll: () => {
        const rear = K([0, 0], [0.35, 1], [0.7, 1], [0.92, 0]), fold = K([0, 0], [0.2, 1], [0.75, 1], [0.92, 0]);
        return { dur: 1.0, events: [{ t: 0.55, name: 'cast' }],
          delta: (t) => { const r = rear(t), f = fold(t); return { pitch: -0.55 * r, y: -0.12 * r, neck: 0.05 * r, head: 0.1 * r,
            fur: () => [-0.15 * r, 0], tail: (k, fan, j, n) => [j === 0 ? -0.2 * r : 0, 0],
            legs: { FL: { free: f, fz: 0.25, fy: -0.45, curl: 0.8 * f }, FR: { free: f, fz: 0.2, fy: -0.5, curl: 0.8 * f } } }; } };
      },
    },
  },

  SK_Pet_Yinglong: {
    key: 'yinglong', name: '应龙', plan: 'dragon', gameplaySpeed: 14,
    idle: { period: 4, waveHz: 0.5, waveV: 0.09, waveL: 0.05, lambda: 0.85, flapHz: 1.5, amp: 0.55, raise: 0.15, bob: 0.012 },
    walk: { period: 4 / 3, waveHz: 0.75, waveV: 0.11, waveL: 0.06, lambda: 0.85, flapHz: 2.25, amp: 0.7, pitch: 0.08, speed: 6.5 },
    move: { period: 1, waveHz: 1, waveV: 0.13, waveL: 0.06, lambda: 0.85, flapHz: 2, amp: 0.85, sweep: 0.2, pitch: 0.12, speed: 14 },
    actions: {
      // 龙息：向后盘颈蓄力（0–0.28 s）→ 头猛地前探张口（0.33 s 事件 fire）→ 回正
      breath: () => {
        const coil = K([0, 0], [0.28, 1], [0.36, 0]), thrust = K([0, 0], [0.28, 0], [0.36, 1], [0.45, 1], [0.6, 0]);
        const jaw = K([0, 0], [0.25, 0.15], [0.33, 0.5], [0.45, 0.5], [0.58, 0]);
        return { dur: 0.6, events: [{ t: 0.33, name: 'fire' }],
          delta: (t) => { const c = coil(t), h = thrust(t); return { coil1: -0.35 * c + 0.2 * h, coil2: 0.3 * c - 0.05 * h, head: -0.2 * c + 0.1 * h,
            chest: -0.12 * c + 0.08 * h, jaw: jaw(t), raise: 0.2 * c, amp: -0.25 * c, fur: -0.2 * h }; } };
      },
      // 兴云布雨：前身立起、双翼张满上举、仰头长吟（0.55 s 事件 cast）
      storm: () => {
        const e = K([0, 0], [0.35, 1], [0.75, 1], [1.0, 0]), roar = K([0, 0], [0.4, 0], [0.5, 1], [0.75, 1], [0.9, 0]);
        return { dur: 1.0, events: [{ t: 0.55, name: 'cast' }],
          // 绑定姿势的颈已经接近竖直：身体立起时颈部反向补一点，头不至于仰过头顶
          delta: (t) => { const a = e(t); return { pitch: -0.32 * a, chest: -0.1 * a, neck: 0.12 * a, head: -0.25 * roar(t), jaw: 0.5 * roar(t),
            raise: 0.7 * a, sweep: -0.25 * a, amp: -0.3 * a, tailDroop: 0.3 * a, fur: -0.3 * a, ftuck: -0.4 * a, freach: 0.3 * a }; } };
      },
    },
  },
};

// ═════════════════════════ 生成 ═════════════════════════

function bakePet(sk, id, spec) {
  const plan = PLANS[spec.plan];
  const R = plan.build(sk);
  const notes = [`程序生成（bake-pet-anims.mjs，${spec.plan}）`];
  if (R.missing.length) notes.push(`骨架里没有：${R.missing.join(', ')}（相应动作略过）`);
  const rest = sampleFrame(sk);
  const clips = {};
  // 落脚 IK 没够着的最大距离（腿伸直了还差多少）：> 几毫米说明步幅 / 身体起伏超出腿长，脚会滑
  const miss = (name) => { if ((R.ikMiss ?? 0) > 0.003) notes.push(`${name}: 落脚 IK 差 ${(R.ikMiss * 1000).toFixed(1)} mm 够不着`); R.ikMiss = 0; };
  clips.Idle = recordClip(sk, FPS, { dur: spec.idle.period, loop: true, pose: (t) => plan.pose(R, plan.idle(R, spec.idle, t)) });
  miss('Idle');
  for (const [name, g] of [['Walk', spec.walk], ['Move', spec.move]]) {
    const gc = plan.gait(R, spec, g);
    notes.push(`${name}: ${gc.note}`);
    clips[name] = recordClip(sk, FPS, { dur: gc.dur, loop: true, pose: (t) => plan.pose(R, gc.pose(t)), speed: gc.speed });
    miss(name);
  }
  const acts = Object.fromEntries(Object.entries(spec.actions).map(([name, make]) => [name, make(R)]));
  // 连段的后一段接着前一段的时间算待机底子（呼吸、尾巴摆动不在接缝处跳）
  const offset = (name) => {
    const prev = Object.entries(acts).find(([, a]) => a.next === name);
    return prev ? offset(prev[0]) + prev[1].dur : 0;
  };
  for (const [name, a] of Object.entries(acts)) {
    const t0 = offset(name);
    clips[name] = recordClip(sk, FPS, {
      dur: a.dur, loop: false, rootY: a.rootY, events: a.events, next: a.next,
      pose: (t) => plan.pose(R, merge(plan.idle(R, spec.idle, t0 + t), a.delta(t))),
    });
    miss(name);
  }
  return {
    schema: 1, asset: id, defId: spec.key, fps: FPS, bones: sk.names, sockets: [], socketScale: {},
    rest: rest.map((x) => Math.round(x * 1e5) / 1e5), clips, notes, baked: new Date().toISOString(),
  };
}

// ═════════════════════════ 命令行 ═════════════════════════

function usage(msg) {
  if (msg) console.error(`✘ ${msg}（用法：-h）`);
  else console.error(readFileSync(new URL(import.meta.url), 'utf8').split('\n').filter((l) => l.startsWith('//')).slice(0, 10).join('\n'));
  process.exit(2);
}

const argv = process.argv.slice(2);
const opt = { fromExport: false, fromRig: null, skeleton: null, out: null, check: [], quiet: false };
const wantPets = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--from-export') opt.fromExport = true;
  else if (a === '--from-rig') opt.fromRig = argv[i + 1] && !argv[i + 1].startsWith('--') && argv[i + 1].endsWith('.json') ? argv[++i] : true;
  else if (a === '--skeleton') opt.skeleton = argv[++i];
  else if (a === '--out') opt.out = argv[++i];
  else if (a === '--check') { while (argv[i + 1] && !argv[i + 1].startsWith('--')) opt.check.push(argv[++i]); }
  else if (a === '--quiet') opt.quiet = true;
  else if (a === '-h' || a === '--help') usage();
  else if (a.startsWith('--')) usage(`未知参数 ${a}`);
  else wantPets.push(a);
}

const findPet = (q) => Object.entries(PETS).find(([id, s]) => [id, id.toLowerCase(), s.key, s.name, id.replace('SK_Pet_', '').toLowerCase()].includes(q.toLowerCase()) || id === q || s.name === q);

if (opt.check.length) {
  for (const f of opt.check) {
    const doc = JSON.parse(readFileSync(resolve(f), 'utf8'));
    const spec = PETS[doc.asset] ?? Object.values(PETS).find((s) => s.key === doc.defId);
    printReport(doc, validateDoc(doc, null, { gameplaySpeed: spec?.gameplaySpeed }), `${doc.asset}  ← ${f}`);
  }
  process.exit(0);
}

const CHAR_DIR = rootPath('unity/Assets/Art/Characters');
const insideChars = (p) => { const r = relative(CHAR_DIR, p); return r === '' || (!r.startsWith('..') && !r.includes(':')); };
if ((opt.skeleton || opt.fromRig) && !opt.out) usage('--skeleton / --from-rig 只能写草稿目录：请加 --out <目录>（例如 art/source/pets/_animtest）');
if (opt.out && insideChars(resolve(opt.out))) usage(`--out 不能指向 unity/Assets/Art/Characters 之内（${opt.out}）；正式输出不加 --out`);

const manifest = loadManifest();
const targets = wantPets.length ? wantPets.map((q) => findPet(q) ?? usage(`不认识的灵宠 ${q}（${Object.values(PETS).map((s) => s.key).join(' / ')}）`)) : Object.entries(PETS);
let failed = 0;
for (const [id, spec] of targets) {
  const t0 = Date.now();
  try {
    // 骨架来源
    let model, source;
    if (opt.skeleton) {
      const e = manifest[opt.skeleton];
      if (!e) throw new Error(`清单里没有 ${opt.skeleton}`);
      model = skeletonFromGlb(rootPath(`public/${e.url}`)); source = `${opt.skeleton}（测试骨架）`;
    } else if (opt.fromRig) {
      const f = opt.fromRig === true ? rootPath(`art/pipeline/creature_rigs/${id}.json`) : resolve(opt.fromRig);
      if (!existsSync(f)) throw new Error(`没有骨骼表 ${relative(rootPath('.'), f)}`);
      model = skeletonFromRigJson(f, id); source = `${relative(rootPath('.'), f)}（骨骼表预览）`;
    } else if (opt.fromExport) {
      const x = latestExport(id);
      if (!x) throw new Error(`没有构建导出 art/source/characters/${id}/04_export/${id}_native_vNNN.glb（先跑 build_tripo_creature.py ${id}）`);
      model = skeletonFromGlb(x.file); source = x.rel;
    } else {
      const e = manifest[id];
      if (!e) throw new Error(`${id} 还没发布到 public/assets/manifest.json：发布前用 --from-export（构建导出）`);
      model = skeletonFromGlb(rootPath(`public/${e.url}`)); source = `public/${e.url}`;
    }
    const sk = new Skeleton(model);
    const doc = bakePet(sk, id, spec);
    doc.notes.splice(1, 0, `骨架：${source}`);
    // 输出
    let file;
    if (opt.out) {
      const dir = resolve(opt.out);
      mkdirSync(dir, { recursive: true });
      file = `${dir}${sep}${id}${opt.skeleton ? `@${opt.skeleton}` : opt.fromRig ? '@rig' : ''}.native-anim.json`;
    } else {
      const assetDir = `${CHAR_DIR}${sep}${id}`;
      if (!existsSync(assetDir)) {
        throw new Error(`Unity 里还没有 ${id}（unity/Assets/Art/Characters/${id}/ 不存在）：先发布并运行 python art/pipeline/unity_export.py ${id}；`
          + '想先看效果就加 --out art/source/pets/_animtest');
      }
      mkdirSync(`${assetDir}${sep}Anim`, { recursive: true });
      file = `${assetDir}${sep}Anim${sep}${id}.native-anim.json`;
    }
    if (insideChars(file) && !(/^SK_Pet_/.test(id) && file.includes(`${sep}${id}${sep}Anim${sep}`) && !opt.skeleton && !opt.fromRig)) throw new Error(`拒绝写入 ${file}`);
    writeFileSync(file, JSON.stringify(doc));
    const names = Object.entries(doc.clips).map(([k, c]) => `${k}(${((c.frames.length - 1) / FPS).toFixed(2)}s${c.loop ? '↻' : ''}${c.next ? '→' + c.next : ''})`);
    console.log(`${id} ${spec.name}: ${names.join(' ')}  → ${relative(rootPath('.'), file)}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);
    for (const n of doc.notes.slice(1)) console.log(`  · ${n}`);
    const v = validateDoc(doc, sk, { gameplaySpeed: spec.gameplaySpeed });
    if (!opt.quiet) printReport(doc, v, `  校验 ${id}`);
    else for (const w of v.warnings) console.log(`  ⚠ ${w}`);
  } catch (err) {
    failed++;
    console.log(`${id} ${spec.name}: ✘ ${err.message}`);
    if (process.env.DEBUG) console.log(err.stack);
  }
}
process.exitCode = failed ? 1 : 0;
