/**
 * 岩熊 · 镇山守卫 —— 英雄选择舞台的展示模型。
 *
 * 兽首人身的熊族武僧守卫：约 2.2 米（含耳），宽肩厚背、肩后隆起的熊峰，略前倾的站姿。
 * 熊首放大（HEAD_S）：宽圆脸、额头顺着深色鼻梁滑进长而厚的浅色口吻、吻尖宽黑鼻垫、上唇盖住深一档的下巴；
 * 大圆耳、暖金发光小眼、怒眉与额前白毫。
 * 服装三层：皮毛身体 / 朱红袈裟（左肩斜披、金线田相补丁、前红后暗的两段式下摆）+ 墨色僧裤 + 麻色绑腿 /
 * 装备：左肩巨大七棱石甲（青铜底箍、山形石脊、正面灵火符环、灵光裂纹）、粗麻绳腰带、胸前大颗菩提念珠
 * （四颗暖金微光带光晕）、麻布缠臂 + 石板护臂与护腿、草鞋、背负斗笠。
 * 右肩袒露，右手低持碎岩霰弹枪（枪口朝前下）；左手握拳。
 *
 * 骨架：hips → spine(呼吸缩放层 skin) → chest → 锁骨 → 肩 → 肘 → 腕 → 指；chest → neck → head → 下颌 / 耳；
 *       hips → 髋 → 膝 → 踝（每帧两段 IK，脚掌钉地）；hips → 前后下摆 / 绳结（弹簧跟随）。
 * 右臂在构建期用 IK 解算：让拳心落在霰弹枪握把上。
 */
import * as THREE from 'three';
import type { HeroRig } from './types';
import { BearKit, type Ring, Spring, TAU, clamp, loftNormal, loftPoint, pulse, smooth01, solveArm, track } from './bearKit';

// ───────────────────────────── 配色 ─────────────────────────────

const COL = {
  fur: 0x573825,
  furDark: 0x301f16,
  furLight: 0xc29c6c,
  /** 下巴：比口吻深一档，免得「浅吻 + 暗缝 + 浅下巴」读成八字胡 */
  furMid: 0x86603f,
  nose: 0x151012,
  mouth: 0x4a1918,
  claw: 0xe8dcc2,
  earInner: 0x6b4636,
  robe: 0x8f2a1c,
  robeDark: 0x561a14,
  gold: 0xd3a24a,
  thread: 0xc08f3e,
  pants: 0x383443,
  wrap: 0xa08b68,
  wrapDark: 0x786545,
  rope: 0xae8c55,
  stone: 0x767c6e,
  stoneDark: 0x52574e,
  bronze: 0x9b6d35,
  bead: 0xc2a571,
  straw: 0xb29359,
};
/** 暖金灵光（眼、念珠、符环） */
const GLOW = 0xffc25a;

// ───────────────────────────── 尺寸 ─────────────────────────────

const HIP_Y = 0.93;
const HIP_X = 0.17;
const THIGH = 0.41;
const SHIN = 0.385;
const ANKLE_H = 0.085;
const LEAN = 0.1;
const CHEST_Y = 0.54;
const CLAV_X = 0.25;
const SH_OUT = 0.2;
const UPPER = 0.37;
const FORE = 0.31;
/** 拳心（握把穿过处）相对腕关节的偏移（掌心朝向一侧 / 向下） */
const GRIP_IN = 0.03;
const GRIP_DOWN = 0.085;

/** 站立脚位（root 空间）：左脚略前、右脚略后，外八 */
const FEET = [
  { s: 1, x: 0.255, z: 0.06, yaw: 0.22 },
  { s: -1, x: -0.25, z: -0.03, yaw: -0.2 },
];

// 霰弹枪低持：枪口朝前下方、略向外；拳心（握把中心）落点（root 空间）
const GUN_DIR = new THREE.Vector3(-0.09, -0.55, 0.83).normalize();
const GUN_GRIP = new THREE.Vector3(-0.5, 0.8, 0.13);

const TORSO_SEG = 12;
const TORSO_PH = Math.PI / TORSO_SEG;
const TORSO: Ring[] = [
  { y: 0.0, rx: 0.29, rz: 0.232, cz: 0.0 },
  { y: 0.14, rx: 0.322, rz: 0.27, cz: 0.045 },
  { y: 0.3, rx: 0.36, rz: 0.276, cz: 0.035 },
  { y: 0.44, rx: 0.415, rz: 0.27, cz: 0.02 },
  { y: 0.55, rx: 0.425, rz: 0.245, cz: 0.0 },
  { y: 0.65, rx: 0.3, rz: 0.2, cz: -0.025 },
  { y: 0.72, rx: 0.15, rz: 0.14, cz: -0.01 },
];

/** 头部整体放大：熊首要大而宽，压得住巨大的肩背 */
const HEAD_S = 1.22;
const CRAN_SEG = 10;
const CRAN_PH = Math.PI / CRAN_SEG;
const CRAN: Ring[] = [
  { y: -0.03, rx: 0.13, rz: 0.125, cz: -0.01 },
  { y: 0.05, rx: 0.178, rz: 0.158, cz: 0.0 },
  { y: 0.14, rx: 0.196, rz: 0.17, cz: 0.005 },
  { y: 0.22, rx: 0.18, rz: 0.16, cz: 0.0 },
  { y: 0.28, rx: 0.138, rz: 0.128, cz: -0.01 },
  { y: 0.312, rx: 0.07, rz: 0.07, cz: -0.015 },
];

// 袈裟斜披：左肩高、右腰低的斜平面 y = Y0 + K·x
const SASH_Y0 = 0.37;
const SASH_K = 0.72;
const SASH_H = 0.12;

// ───────────────────────────── 亮相关键帧 ─────────────────────────────
// 「金刚捣碓」：提膝举拳蓄力 → 震脚砸拳（身体下沉）→ 定住 → 挺胸昂首 → 回到待机。
// 每条轨道 [t, 值, 标志]：0 平滑、1 停顿、2 砸击（加速冲入后急停）。值均为相对待机的增量。

const T_P = 0.42; // 蓄力顶点
const T_I = 0.56; // 砸击
const T_H = 0.76; // 定住
const T_R = 1.08; // 挺起
const INTRO_LEN = 1.62;

const CH_HY = 0;
const CH_HX = 1;
const CH_HZ = 2;
const CH_FLY = 3;
const CH_FLZ = 4;
const CH_SX = 5;
const CH_SY = 6;
const CH_SZ = 7;
const CH_NX = 8;
const CH_HDX = 9;
const CH_HDY = 10;
const CH_JAW = 11;
const CH_LX = 12;
const CH_LZ = 13;
const CH_LE = 14;
const CH_CL = 15;
const CH_GL = 16;
const CH_CE = 17;
const CH_SH = 18;
const CH_LY = 19;

const TRACKS: readonly (readonly number[])[] = [
  /* HY  */ [0, 0, 1, 0.15, -0.035, 0, T_P, 0.015, 1, T_I, -0.15, 2, 0.64, -0.172, 0, T_H, -0.162, 1, T_R, 0.022, 0, 1.34, -0.006, 0, INTRO_LEN, 0, 1],
  /* HX  */ [0, 0, 1, T_P, -0.05, 1, T_I, -0.012, 0, T_H, 0, 1, INTRO_LEN, 0, 1],
  /* HZ  */ [0, 0, 1, T_P, 0.0, 0, T_I, -0.045, 2, T_H, -0.05, 1, T_R, 0.0, 0, INTRO_LEN, 0, 1],
  /* FLY */ [0, 0, 1, 0.1, 0, 1, T_P, 0.34, 1, T_I, 0, 2, INTRO_LEN, 0, 1],
  /* FLZ */ [0, 0, 1, T_P, 0.1, 1, T_I, 0, 2, INTRO_LEN, 0, 1],
  /* SX  */ [0, 0, 1, 0.15, 0.04, 0, T_P, -0.12, 1, T_I, 0.34, 2, T_H, 0.37, 1, T_R, -0.15, 0, 1.36, 0.02, 0, INTRO_LEN, 0, 1],
  /* SY  */ [0, 0, 1, T_P, 0.16, 1, T_I, -0.1, 2, T_H, -0.08, 1, T_R, 0.0, 0, INTRO_LEN, 0, 1],
  /* SZ  */ [0, 0, 1, T_P, 0.06, 1, T_I, -0.02, 0, T_H, 0, 1, INTRO_LEN, 0, 1],
  /* NX  */ [0, 0, 1, T_P, -0.1, 1, T_I, 0.12, 0, T_H, 0.1, 1, T_R, -0.08, 0, INTRO_LEN, 0, 1],
  /* HDX */ [0, 0, 1, 0.46, -0.1, 1, 0.62, 0.2, 0, 0.82, 0.16, 1, 1.12, -0.1, 0, 1.38, -0.02, 0, INTRO_LEN, 0, 1],
  /* HDY */ [0, 0, 1, T_P, 0.12, 1, T_I, 0.05, 0, T_H, 0, 1, INTRO_LEN, 0, 1],
  /* JAW */ [0, 0, 1, 0.86, 0, 1, T_R, 0.3, 1, 1.32, 0.04, 0, INTRO_LEN, 0, 1],
  /* LX  */ [0, 0, 1, T_P, -1.3, 1, T_I, -0.98, 2, T_H, -0.92, 1, T_R, 0.12, 0, 1.34, 0.02, 0, INTRO_LEN, 0, 1],
  /* LZ  */ [0, 0, 1, T_P, 0.1, 1, T_I, -0.56, 2, T_H, -0.52, 1, T_R, 0.2, 1, INTRO_LEN, 0, 1],
  /* LE  */ [0, 0, 1, T_P, -1.55, 1, T_I, 0.2, 2, T_H, 0.16, 1, T_R, -1.0, 0, 1.32, -0.2, 0, INTRO_LEN, 0, 1],
  /* CL  */ [0, 0, 1, 0.22, 1, 1, 1.32, 1, 1, INTRO_LEN, 0, 1],
  /* GL  */ [0, 0, 1, 0.15, 0, 1, T_P, 0.35, 0, T_I - 0.01, 0.42, 0, T_I + 0.025, 1, 2, 0.82, 0.45, 0, 1.22, 0.12, 0, INTRO_LEN, 0, 1],
  /* CE  */ [0, 0, 1, T_I, 0, 1, T_R, 0.05, 1, 1.36, 0.01, 0, INTRO_LEN, 0, 1],
  /* SH  */ [0, 0, 1, T_I, 0, 1, T_I + 0.04, 1, 0, T_I + 0.1, -0.6, 0, T_I + 0.17, 0.35, 0, T_I + 0.25, -0.15, 0, T_I + 0.34, 0, 1, INTRO_LEN, 0, 1],
  /* LY  */ [0, 0, 1, T_P, -0.25, 1, T_I, 0.05, 0, T_H, 0, 1, INTRO_LEN, 0, 1],
];
const N_CH = TRACKS.length;

/** 待机看向序列（11 秒一循环，缓慢转头 + 停留） */
const LOOK = [0, 0, 1, 1.6, 0, 1, 3.1, 0.3, 1, 5.0, 0.3, 1, 6.5, -0.22, 1, 8.4, -0.22, 1, 9.7, 0, 1, 11, 0, 1];
const LOOK_LEN = 11;

// ───────────────────────────── 模块级临时变量 ─────────────────────────────

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const GLOW_C = new THREE.Color(GLOW);

interface HandRig {
  s: number;
  f1: THREE.Group[];
  f2: THREE.Group[];
  thumb: THREE.Group;
}

interface LegRig {
  s: number;
  hip: THREE.Group;
  knee: THREE.Group;
  ankle: THREE.Group;
  fx: number;
  fz: number;
  yaw: number;
}

export function buildBearModel(): HeroRig {
  const k = new BearKit();
  const M = {
    fur: k.std(COL.fur, 0.92),
    furDark: k.std(COL.furDark, 0.95),
    furLight: k.std(COL.furLight, 0.9),
    furMid: k.std(COL.furMid, 0.92),
    nose: k.std(COL.nose, 0.4, 0.1),
    mouth: k.std(COL.mouth, 0.8),
    claw: k.std(COL.claw, 0.5),
    earInner: k.std(COL.earInner, 0.9),
    robe: k.std(COL.robe, 0.78),
    robeDark: k.std(COL.robeDark, 0.85),
    gold: k.std(COL.gold, 0.38, 0.75),
    thread: k.std(COL.thread, 0.7, 0.25),
    pants: k.std(COL.pants, 0.9),
    wrap: k.std(COL.wrap, 0.95),
    wrapDark: k.std(COL.wrapDark, 0.95),
    rope: k.std(COL.rope, 0.95),
    stone: k.std(COL.stone, 0.95),
    stoneDark: k.std(COL.stoneDark, 0.95),
    bronze: k.std(COL.bronze, 0.42, 0.7),
    bead: k.std(COL.bead, 0.55),
    straw: k.std(COL.straw, 0.95),
    eye: k.glow(GLOW),
    beadGlow: k.glow(GLOW),
    rune: k.glow(GLOW),
    halo: k.additive(0x000000),
    beadHalo: k.additive(0x000000),
  };

  const root = new THREE.Group();
  root.name = 'hero:bear';
  const hips = k.joint(root, 0, HIP_Y, 0);

  // ───────────── 骨盆 / 腰带 / 下摆 ─────────────
  k.mesh(hips, k.loft([
    { y: -0.17, rx: 0.26, rz: 0.2 },
    { y: -0.04, rx: 0.3, rz: 0.232 },
    { y: 0.1, rx: 0.298, rz: 0.234 },
  ], 10), M.pants);

  // 粗麻绳腰带（两股）+ 右前绳结与垂绳
  k.mesh(hips, k.torus(0.305, 0.032, 5, 16), M.rope, 0, 0.088, 0.0, 0, 0, 0.02, 1, 1, 0.8);
  k.mesh(hips, k.torus(0.3, 0.03, 5, 16), M.rope, 0, 0.038, 0.0, 0, 0.3, -0.02, 1, 1, 0.8);
  const knot = k.joint(hips, -0.13, 0.06, 0.24);
  k.mesh(knot, k.dodeca(0.048), M.rope, 0, 0, 0.0, 0.4, 0.3, 0);
  const ropeEnds = k.joint(knot, 0, -0.02, 0.01);
  // 青铜法铃
  k.mesh(ropeEnds, k.cyl(0.006, 0.006, 0.06, 4, 'top'), M.rope, 0, 0, 0.012);
  k.mesh(ropeEnds, k.cyl(0.014, 0.034, 0.05, 8, 'top'), M.bronze, 0, -0.06, 0.012);
  k.mesh(ropeEnds, k.ico(0.012, 0), M.gold, 0, -0.112, 0.012);
  for (const [dx, rz, len] of [[-0.025, -0.1, 0.3], [0.025, 0.12, 0.25]] as const) {
    const r = k.joint(ropeEnds, dx, 0, 0);
    r.rotation.z = rz;
    k.mesh(r, k.cyl(0.016, 0.016, len, 5, 'top'), M.rope);
    k.mesh(r, k.cyl(0.024, 0.02, 0.03, 6), M.gold, 0, -len, 0);
    k.mesh(r, k.cone(0.03, 0.09, 6, 'top'), M.robe, 0, -len - 0.01, 0, Math.PI, 0, 0);
  }

  // 袈裟下摆（前两片朱红、后两片暗红；布片下缘微微外翻，只留金线滚边，不再画成方格）
  // 每片分上下两段：上段随大腿摆，下段在膝前自然垂落（提膝时不会像木板一样平伸出去）
  const FLAP_B = 0.66;
  const flap = (x: number, z: number, yaw: number, w: number, len: number, mat: THREE.Material): { up: THREE.Group; lo: THREE.Group } => {
    const p = k.joint(hips, x, 0.065, z);
    p.rotation.y = yaw;
    const up = k.joint(p, 0, 0, 0);
    const wM = w * 1.13;
    const wB = w * 1.22;
    const r = Math.SQRT1_2;
    const l1 = len * FLAP_B;
    const l2 = len - l1;
    k.mesh(up, k.loft([
      { y: -l1 - 0.012, rx: wM * r, rz: 0.028 * r, cz: 0.012 },
      { y: 0, rx: w * r, rz: 0.028 * r },
    ], 4, true, true, Math.PI / 4), mat);
    const lo = k.joint(up, 0, -l1, 0.012);
    k.mesh(lo, k.loft([
      { y: -l2, rx: wB * r, rz: 0.026 * r, cz: 0.016 },
      { y: 0.004, rx: wM * r, rz: 0.028 * r },
    ], 4, true, true, Math.PI / 4), mat);
    k.mesh(lo, k.box(wB * 1.02, 0.028, 0.03), M.thread, 0, -l2 + 0.016, 0.016, 0.06, 0, 0);
    return { up, lo };
  };
  const flapFL = flap(0.125, 0.236, 0.22, 0.22, 0.45, M.robe);
  const flapFR = flap(-0.125, 0.236, -0.22, 0.22, 0.45, M.robe);
  const flapBL = flap(0.13, -0.236, Math.PI - 0.22, 0.25, 0.46, M.robeDark);
  const flapBR = flap(-0.13, -0.236, Math.PI + 0.22, 0.25, 0.46, M.robeDark);

  // ───────────── 腿 ─────────────
  const legs: LegRig[] = FEET.map((f) => {
    const s = f.s;
    const hip = k.joint(hips, s * HIP_X, -0.06, 0);
    // 宽松僧裤
    k.mesh(hip, k.loft([
      { y: -0.43, rx: 0.13, rz: 0.13 },
      { y: -0.34, rx: 0.147, rz: 0.146 },
      { y: -0.19, rx: 0.168, rz: 0.166, cx: s * 0.008 },
      { y: -0.04, rx: 0.178, rz: 0.182 },
      { y: 0.08, rx: 0.15, rz: 0.16 },
    ], 8), M.pants);
    const knee = k.joint(hip, 0, -THIGH, 0);
    // 石质护膝
    k.mesh(knee, k.dodeca(0.085), M.stone, 0, 0.0, 0.112, 0.3, 0.2, 0, 1.05, 0.85, 0.55);
    k.mesh(knee, k.cyl(0.024, 0.026, 0.02, 6), M.bronze, 0, 0.0, 0.158, Math.PI / 2, 0, 0);
    // 绑腿小腿
    k.mesh(knee, k.loft([
      { y: -0.375, rx: 0.092, rz: 0.095 },
      { y: -0.25, rx: 0.102, rz: 0.106 },
      { y: -0.1, rx: 0.128, rz: 0.134, cz: -0.012 },
      { y: 0.03, rx: 0.124, rz: 0.124 },
    ], 8), M.wrap);
    for (let i = 0; i < 4; i++) {
      const y = -0.06 - i * 0.078;
      const r = 0.128 - i * 0.009;
      const band = k.loft([{ y: -0.012, rx: r + 0.006, rz: r + 0.009 }, { y: 0.012, rx: r + 0.006, rz: r + 0.009 }], 8, false, false);
      k.mesh(knee, band, M.wrapDark, 0, y, -0.004, i % 2 ? 0.16 : -0.16, 0, 0);
    }
    // 石板护腿 + 青铜束带 + 灵光刻纹
    const plate = k.joint(knee, 0, -0.17, 0.112);
    plate.rotation.x = -0.12;
    k.mesh(plate, k.taper(0.1, 0.14, 0.04, 0.045, 0.23), M.stone);
    k.mesh(plate, k.box(0.15, 0.022, 0.05), M.bronze, 0, 0.092, 0);
    k.mesh(plate, k.box(0.115, 0.02, 0.05), M.bronze, 0, -0.092, 0);
    k.mesh(plate, k.octa(1), M.rune, 0, 0.0, 0.022, 0, 0, 0, 0.022, 0.04, 0.008);
    const ankle = k.joint(knee, 0, -SHIN, 0);
    // 踝部毛翻边
    k.mesh(ankle, k.loft([
      { y: -0.035, rx: 0.098, rz: 0.1 },
      { y: 0.005, rx: 0.118, rz: 0.12 },
      { y: 0.05, rx: 0.098, rz: 0.1 },
    ], 8), M.furDark);
    // 熊掌（沿 +Z 放样；横向 / 纵向放大，脚底仍贴地）
    const foot = k.joint(ankle, 0, 0, 0);
    foot.scale.set(1.14, 1, 1.1);
    k.mesh(foot, k.loftZ([
      { y: -0.09, rx: 0.085, rz: 0.05, cz: -0.012 },
      { y: 0.0, rx: 0.1, rz: 0.06, cz: -0.002 },
      { y: 0.11, rx: 0.11, rz: 0.046, cz: -0.018 },
      { y: 0.17, rx: 0.094, rz: 0.028, cz: -0.034 },
    ], 8), M.fur);
    for (let i = 0; i < 4; i++) {
      const x = (i - 1.5) * 0.042;
      k.mesh(foot, k.dodeca(0.03), M.furDark, x, -0.045, 0.16 - Math.abs(i - 1.5) * 0.012);
      k.mesh(foot, k.cone(0.011, 0.05, 4), M.claw, x, -0.052, 0.185 - Math.abs(i - 1.5) * 0.012, Math.PI / 2 + 0.35, 0, 0);
    }
    // 草鞋
    k.mesh(foot, k.taper(0.2, 0.2, 0.33, 0.31, 0.022), M.straw, 0, -ANKLE_H + 0.011, 0.04);
    k.mesh(foot, k.box(0.215, 0.018, 0.03), M.straw, 0, -0.028, 0.075, 0.45, 0, 0);
    k.mesh(foot, k.box(0.2, 0.018, 0.03), M.straw, 0, -0.03, -0.045, -0.5, 0, 0);
    return { s, hip, knee, ankle, fx: f.x, fz: f.z, yaw: f.yaw };
  });

  // ───────────── 躯干 ─────────────
  const spine = k.joint(hips, 0, 0.08, 0);
  spine.rotation.x = LEAN;
  const skin = k.joint(spine, 0, 0, 0);
  k.mesh(skin, k.loft(TORSO, TORSO_SEG), M.fur);

  // 胸前月牙（浅色胸毛）
  const cres = (a: number): number => (a / 0.95) * (a / 0.95);
  k.mesh(skin, k.wrap(TORSO, TORSO_SEG, TORSO_PH, -0.95, 0.95, 16,
    (a) => 0.43 + 0.11 * cres(a) - (0.036 * (1 - 0.8 * cres(a)) + 0.004),
    (a) => 0.43 + 0.11 * cres(a) + (0.036 * (1 - 0.8 * cres(a)) + 0.004), 1, 0.007), M.furLight);

  // 右胸肌块（袒露侧）
  {
    const a = -0.5;
    const y = 0.45;
    loftPoint(TORSO, TORSO_SEG, TORSO_PH, a, y, _v);
    loftNormal(TORSO, TORSO_SEG, TORSO_PH, a, y, _n);
    const pec = k.mesh(skin, k.dodeca(1), M.fur, _v.x - _n.x * 0.01, _v.y, _v.z - _n.z * 0.01, 0, 0, 0, 0.16, 0.095, 0.06);
    pec.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), _n);
    pec.rotateZ(0.25);
  }

  // 袈裟斜披（左肩 → 右腰）
  const sashMid = (a: number): number => {
    let y = 0.4;
    for (let i = 0; i < 2; i++) y = SASH_Y0 + SASH_K * loftPoint(TORSO, TORSO_SEG, TORSO_PH, a, y, _v).x;
    return y;
  };
  const sLo = (a: number): number => clamp(sashMid(a) - SASH_H, 0.02, 0.7);
  const sHi = (a: number): number => clamp(sashMid(a) + SASH_H, 0.02, 0.715);
  k.mesh(skin, k.wrap(TORSO, TORSO_SEG, TORSO_PH, 0, TAU, 72, sLo, sHi, 3, 0.012), M.robe);
  k.mesh(skin, k.wrap(TORSO, TORSO_SEG, TORSO_PH, 0, TAU, 72, (a) => sLo(a) - 0.008, (a) => sLo(a) + 0.016, 1, 0.019), M.thread);
  k.mesh(skin, k.wrap(TORSO, TORSO_SEG, TORSO_PH, 0, TAU, 72, (a) => sHi(a) - 0.016, (a) => Math.min(0.716, sHi(a) + 0.008), 1, 0.019), M.thread);
  for (let i = 0; i < 10; i++) {
    const a = 0.25 + (i * TAU) / 10;
    k.mesh(skin, k.wrap(TORSO, TORSO_SEG, TORSO_PH, a - 0.02, a + 0.02, 1, sLo, sHi, 3, 0.02), M.thread);
  }

  // 熊峰（肩后隆起）+ 毛簇
  k.mesh(skin, k.dodeca(1), M.fur, 0, 0.62, -0.12, 0.35, 0, 0, 0.27, 0.15, 0.17);
  for (const [x, y, z, rx, rz] of [[0.0, 0.68, -0.24, -1.75, 0], [0.13, 0.62, -0.24, -1.9, -0.35], [-0.13, 0.62, -0.24, -1.9, 0.35]] as const) {
    k.mesh(skin, k.cone(0.055, 0.09, 4), M.furDark, x, y, z, rx, 0, rz);
  }

  // 背负斗笠（行脚僧的竹编斗笠，绳挂在颈后念珠上）
  {
    const hat = k.joint(skin, 0.04, 0.4, -0.31);
    hat.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0.05, 0.25, -1).normalize());
    hat.rotateY(0.3);
    k.mesh(hat, k.cone(0.245, 0.11, 12), M.straw, 0, 0, 0);
    k.mesh(hat, k.cone(0.232, 0.09, 12), M.wrapDark, 0, -0.006, 0, Math.PI, 0, 0, 1, 0.12, 1);
    k.mesh(hat, k.torus(0.12, 0.011, 4, 12), M.robeDark, 0, 0.057, 0);
    k.mesh(hat, k.cyl(0.026, 0.035, 0.028, 6), M.bronze, 0, 0.114, 0);
    k.mesh(skin, k.cyl(0.008, 0.008, 0.3, 4), M.rope, 0.0, 0.58, -0.27, -0.2, 0, 0);
  }

  // 念珠：颈后一圈 + 胸前 U 形垂挂（前段挂在 beadPivot 上可甩动）
  const beadPivot = k.joint(skin, 0, 0, 0);
  loftPoint(TORSO, TORSO_SEG, TORSO_PH, 0, 0.68, _v);
  loftNormal(TORSO, TORSO_SEG, TORSO_PH, 0, 0.68, _n);
  beadPivot.position.copy(_v).addScaledVector(_n, 0.03);
  const beadFront = k.dodeca(0.039);
  const beadBack = k.ico(0.034, 0);
  const beadHaloGeo = k.ico(0.05, 0);
  const glowBeads: THREE.Mesh[] = [];
  {
    // 前段曲线：a = 0.8u，y = 0.30 + 0.40u²；按弧长均分
    const N = 200;
    const pts: THREE.Vector3[] = [];
    const len: number[] = [0];
    for (let i = 0; i <= N; i++) {
      const u = -1 + (2 * i) / N;
      const a = 0.8 * u;
      const y = 0.3 + 0.4 * u * u;
      const p = loftPoint(TORSO, TORSO_SEG, TORSO_PH, a, y, new THREE.Vector3());
      loftNormal(TORSO, TORSO_SEG, TORSO_PH, a, y, _n);
      p.addScaledVector(_n, 0.039 + 0.026);
      if (i > 0) len.push(len[i - 1] + p.distanceTo(pts[i - 1]));
      pts.push(p);
    }
    const total = len[N];
    const COUNT = 15;
    let j = 0;
    for (let b = 0; b < COUNT; b++) {
      const target = (total * b) / (COUNT - 1);
      while (j < N - 1 && len[j + 1] < target) j++;
      const f = (target - len[j]) / (len[j + 1] - len[j] || 1);
      _v.copy(pts[j]).lerp(pts[j + 1], f).sub(beadPivot.position);
      if (b === (COUNT - 1) / 2) {
        // 佛头：青铜圆托 + 灵光核心 + 朱红流苏
        const guru = k.joint(beadPivot, _v.x, _v.y, _v.z + 0.012);
        k.mesh(guru, k.cyl(0.052, 0.052, 0.024, 8), M.bronze, 0, 0, 0, Math.PI / 2, 0, 0);
        k.mesh(guru, k.octa(0.03), M.beadGlow, 0, 0, 0.018, 0, 0, 0, 1, 1, 0.7);
        const tassel = k.joint(guru, 0, -0.05, 0);
        k.mesh(tassel, k.cyl(0.016, 0.02, 0.025, 6, 'top'), M.gold);
        k.mesh(tassel, k.cone(0.032, 0.13, 6, 'top'), M.robe, 0, -0.02, 0, Math.PI, 0, 0);
        k.mesh(guru, k.ico(0.09, 0), M.halo, 0, 0, 0.02);
        guru.name = 'guru';
        continue;
      }
      const isGlow = b === 2 || b === 5 || b === 9 || b === 12;
      const m = k.mesh(beadPivot, beadFront, isGlow ? M.beadGlow : M.bead, _v.x, _v.y, _v.z, b * 0.7, b * 0.4, 0);
      if (isGlow) {
        glowBeads.push(m);
        k.mesh(beadPivot, beadHaloGeo, M.beadHalo, _v.x, _v.y, _v.z + 0.01, b, b * 0.3, 0);
      }
    }
    // 颈后段
    for (let b = 0; b < 9; b++) {
      const a = 0.95 + ((TAU - 1.9) * (b + 0.5)) / 9;
      loftPoint(TORSO, TORSO_SEG, TORSO_PH, a, 0.69, _v);
      loftNormal(TORSO, TORSO_SEG, TORSO_PH, a, 0.69, _n);
      _v.addScaledVector(_n, 0.05);
      k.mesh(skin, beadBack, M.bead, _v.x, _v.y, _v.z, b, b * 0.5, 0);
    }
  }
  const guru = beadPivot.getObjectByName('guru') as THREE.Group;
  const tassel = guru.children[2] as THREE.Group;

  // ───────────── 胸 / 颈 / 头 ─────────────
  const chest = k.joint(spine, 0, CHEST_Y, 0);
  const neck = k.joint(chest, 0, 0.105, 0);
  neck.rotation.x = -0.1;
  k.mesh(neck, k.loft([
    { y: -0.1, rx: 0.19, rz: 0.17 },
    { y: 0.05, rx: 0.175, rz: 0.16, cz: 0.012 },
    { y: 0.15, rx: 0.15, rz: 0.14, cz: 0.025 },
  ], 10), M.fur);
  for (const [x, rz] of [[0.07, -0.4], [-0.07, 0.4], [0, 0]] as const) {
    k.mesh(neck, k.cone(0.04, 0.11, 4), M.furDark, x, 0.06, -0.12, -2.0, 0, rz);
  }

  const head = k.joint(neck, 0, 0.1, 0.04);
  head.rotation.x = -0.02;
  head.scale.setScalar(HEAD_S);
  k.mesh(head, k.loft(CRAN, CRAN_SEG), M.fur);
  // 宽圆的腮帮毛（熊脸宽而圆，不要尖刺）+ 后脑毛簇
  for (const s of [1, -1]) {
    k.mesh(head, k.dodeca(0.09), M.fur, s * 0.142, 0.085, 0.05, 0.3, s * 0.4, 0, 1, 0.92, 0.95);
    k.mesh(head, k.dodeca(0.07), M.fur, s * 0.17, 0.035, -0.02, 0.5, s * 0.2, 0.3, 1, 0.8, 1);
    k.mesh(head, k.cone(0.04, 0.075, 4), M.fur, s * 0.155, 0.0, 0.0, -0.4, 0, s * -2.5);
    k.mesh(head, k.cone(0.035, 0.09, 4), M.furDark, s * 0.06, 0.14, -0.15, -2.1, 0, s * -0.35);
  }
  // 吻部（上吻）：从眉间斜出的长吻，顶面平（鼻梁），向前收窄、略下垂
  k.mesh(head, k.loftZ([
    { y: 0.05, rx: 0.13, rz: 0.115, cz: 0.112 },
    { y: 0.17, rx: 0.122, rz: 0.1, cz: 0.11 },
    { y: 0.24, rx: 0.104, rz: 0.084, cz: 0.103 },
    { y: 0.288, rx: 0.082, rz: 0.066, cz: 0.099 },
    { y: 0.315, rx: 0.055, rz: 0.046, cz: 0.097 },
  ], 10, true, true, 0), M.furLight);
  // 鼻梁毛：额头顺坡滑到吻部（侧面不再是「额头竖墙 + 横插一块吻」）
  k.mesh(head, k.loftZ([
    { y: 0.09, rx: 0.058, rz: 0.045, cz: 0.238 },
    { y: 0.19, rx: 0.052, rz: 0.034, cz: 0.208 },
    { y: 0.245, rx: 0.044, rz: 0.02, cz: 0.186 },
    { y: 0.278, rx: 0.034, rz: 0.01, cz: 0.17 },
  ], 6, true, true, 0), M.fur);
  // 鼻头：宽大的黑色鼻垫，略上翘、悬在吻尖
  k.mesh(head, k.dodeca(1), M.nose, 0, 0.142, 0.305, -0.3, 0, 0, 0.049, 0.032, 0.036);
  k.mesh(head, k.box(0.007, 0.026, 0.01), M.nose, 0, 0.1, 0.314);
  // 口腔 + 上犬齿：只在张嘴时显示（闭嘴时完全藏起，避免从吻侧穿出）
  const mouthG = k.joint(head, 0, 0, 0);
  k.mesh(mouthG, k.box(0.1, 0.04, 0.22), M.mouth, 0, 0.02, 0.16);
  for (const s of [1, -1]) k.mesh(mouthG, k.cone(0.012, 0.034, 4, 'top'), M.claw, s * 0.045, 0.035, 0.262, Math.PI, 0, 0);
  // 下颌（厚实，收在上吻之下；张嘴时向下转）
  const jaw = k.joint(head, 0, 0.06, 0.05);
  k.mesh(jaw, k.loftZ([
    { y: 0.0, rx: 0.106, rz: 0.05, cz: -0.04 },
    { y: 0.12, rx: 0.09, rz: 0.042, cz: -0.05 },
    { y: 0.185, rx: 0.072, rz: 0.034, cz: -0.042 },
    { y: 0.228, rx: 0.048, rz: 0.025, cz: -0.034 },
  ], 8), M.furMid);
  const lowFangs = k.joint(jaw, 0, 0, 0);
  for (const s of [1, -1]) k.mesh(lowFangs, k.cone(0.01, 0.03, 4), M.claw, s * 0.04, -0.01, 0.2);
  // 眼（暖金发光）+ 眼窝 + 怒眉 + 白毫
  const eyes: THREE.Mesh[] = [];
  for (const s of [1, -1]) {
    const y = 0.207;
    const a = s * Math.asin(0.083 / 0.19);
    loftPoint(CRAN, CRAN_SEG, CRAN_PH, a, y, _v);
    loftNormal(CRAN, CRAN_SEG, CRAN_PH, a, y, _n);
    k.mesh(head, k.box(0.056, 0.036, 0.02), M.furDark, _v.x + _n.x * 0.002, y, _v.z + _n.z * 0.002, 0, s * 0.42, s * 0.22);
    eyes.push(k.mesh(head, k.octa(1), M.eye, _v.x + _n.x * 0.01, y, _v.z + _n.z * 0.01, 0, s * 0.42, s * 0.22, 0.024, 0.016, 0.012));
    const by = 0.243;
    const ba = s * Math.asin(0.08 / 0.185);
    loftPoint(CRAN, CRAN_SEG, CRAN_PH, ba, by, _v);
    loftNormal(CRAN, CRAN_SEG, CRAN_PH, ba, by, _n);
    k.mesh(head, k.taper(0.075, 0.07, 0.05, 0.035, 0.03), M.furDark, _v.x + _n.x * 0.012, by, _v.z + _n.z * 0.012, -0.35, s * 0.4, s * 0.34);
  }
  loftPoint(CRAN, CRAN_SEG, CRAN_PH, 0, 0.27, _v);
  k.mesh(head, k.octa(0.014), M.rune, 0, 0.27, _v.z + 0.008, 0, 0, 0, 1, 1, 0.6);
  // 圆耳（大而圆、立在头顶两侧，微向前兜）
  const ears: THREE.Group[] = [];
  for (const s of [1, -1]) {
    loftPoint(CRAN, CRAN_SEG, CRAN_PH, s * 0.85, 0.25, _v);
    const ear = k.joint(head, _v.x * 0.92, 0.252, _v.z * 0.6 - 0.015);
    ear.rotation.set(0.12, s * 0.32, s * -0.42);
    k.mesh(ear, k.cyl(0.08, 0.08, 0.04, 10), M.fur, 0, 0.042, 0, Math.PI / 2, 0, 0, 1, 1, 0.9);
    k.mesh(ear, k.cyl(0.05, 0.05, 0.014, 10), M.earInner, 0, 0.044, 0.018, Math.PI / 2, 0, 0, 1, 1, 0.9);
    ears.push(ear);
  }

  // ───────────── 手臂 ─────────────
  const buildHand = (hand: THREE.Group, s: number): HandRig => {
    k.mesh(hand, k.taper(0.084, 0.074, 0.14, 0.12, 0.11, 'top'), M.fur);
    const f1: THREE.Group[] = [];
    const f2: THREE.Group[] = [];
    for (let i = 0; i < 4; i++) {
      const j1 = k.joint(hand, -s * 0.006, -0.1, 0.052 - i * 0.0347);
      k.mesh(j1, k.box(0.042, 0.052, 0.032, 'top'), M.fur);
      const j2 = k.joint(j1, 0, -0.047, 0);
      k.mesh(j2, k.box(0.038, 0.042, 0.03, 'top'), M.furDark);
      k.mesh(j2, k.cone(0.011, 0.034, 4), M.claw, 0, -0.038, 0, Math.PI, 0, -s * 0.3);
      f1.push(j1);
      f2.push(j2);
    }
    const thumb = k.joint(hand, -s * 0.034, -0.028, 0.062);
    k.mesh(thumb, k.box(0.038, 0.06, 0.036, 'top'), M.fur);
    k.mesh(thumb, k.cone(0.011, 0.032, 4), M.claw, 0, -0.058, 0, Math.PI, 0, 0);
    return { s, f1, f2, thumb };
  };
  const curl = (h: HandRig, c: number): void => {
    const s = h.s;
    for (let i = 0; i < 4; i++) {
      const lag = i * 0.04;
      const ci = clamp(c * (1 + lag) - lag, 0, 1);
      h.f1[i].rotation.z = -s * (0.18 + 1.34 * ci);
      h.f2[i].rotation.z = -s * (0.2 + 1.38 * ci);
    }
    h.thumb.rotation.set(-0.3 - 0.4 * c, 0, -s * (0.3 + 0.8 * c));
  };

  const buildArm = (s: number): { clav: THREE.Group; sh: THREE.Group; el: THREE.Group; hand: THREE.Group; rig: HandRig } => {
    const clav = k.joint(chest, s * CLAV_X, 0.0, -0.01);
    const sh = k.joint(clav, s * SH_OUT, -0.01, 0);
    k.mesh(sh, k.loft([
      { y: -UPPER, rx: 0.095, rz: 0.1 },
      { y: -0.25, rx: 0.115, rz: 0.118 },
      { y: -0.12, rx: 0.133, rz: 0.13 },
      { y: 0.0, rx: 0.142, rz: 0.138 },
      { y: 0.08, rx: 0.1, rz: 0.1 },
    ], 8), M.fur);
    k.mesh(sh, k.dodeca(0.13), M.fur, s * 0.012, 0.005, 0, 0, 0, 0, 1, 0.95, 1.05);
    const el = k.joint(sh, 0, -UPPER, 0);
    k.mesh(el, k.loft([
      { y: -FORE, rx: 0.08, rz: 0.084 },
      { y: -0.2, rx: 0.098, rz: 0.1 },
      { y: -0.07, rx: 0.113, rz: 0.118, cz: 0.006 },
      { y: 0.03, rx: 0.098, rz: 0.1 },
    ], 8), M.fur);
    // 护臂：赭布缠裹 + 外侧石板 + 青铜箍
    k.mesh(el, k.loft([
      { y: -0.29, rx: 0.094, rz: 0.098 },
      { y: -0.17, rx: 0.116, rz: 0.12 },
      { y: -0.05, rx: 0.124, rz: 0.128 },
    ], 8, false, false), M.wrap);
    for (let i = 0; i < 3; i++) {
      const y = -0.1 - i * 0.065;
      const r = 0.122 - i * 0.008;
      k.mesh(el, k.loft([{ y: -0.01, rx: r + 0.004, rz: r + 0.007 }, { y: 0.01, rx: r + 0.004, rz: r + 0.007 }], 8, false, false), M.wrapDark, 0, y, 0, i % 2 ? 0.18 : -0.18, 0, 0);
    }
    k.mesh(el, k.taper(0.026, 0.026, 0.09, 0.118, 0.19), M.stone, s * 0.114, -0.17, 0, 0, 0, s * 0.07);
    k.mesh(el, k.octa(1), M.rune, s * 0.128, -0.165, 0, 0, 0, s * 0.07, 0.008, 0.035, 0.016);
    k.mesh(el, k.loft([{ y: -0.075, rx: 0.13, rz: 0.134 }, { y: -0.045, rx: 0.13, rz: 0.134 }], 8, false, false), M.bronze);
    k.mesh(el, k.loft([{ y: -0.302, rx: 0.1, rz: 0.104 }, { y: -0.274, rx: 0.102, rz: 0.106 }], 8, false, false), M.bronze);
    k.mesh(el, k.cone(0.045, 0.1, 4), M.furDark, 0, 0.0, -0.085, -2.1, 0, 0);
    const hand = k.joint(el, 0, -FORE, 0);
    const rig = buildHand(hand, s);
    return { clav, sh, el, hand, rig };
  };
  const armL = buildArm(1);
  const armR = buildArm(-1);

  // 右肩袒露：毛簇 + 金臂钏
  for (const [y, z, rz] of [[-0.05, 0.05, 2.75], [-0.11, -0.03, 2.85], [-0.01, -0.06, 2.6]] as const) {
    k.mesh(armR.sh, k.cone(0.032, 0.07, 4), M.furDark, -0.128, y, z, 0, 0, rz);
  }
  k.mesh(armR.sh, k.torus(0.124, 0.016, 4, 12), M.gold, 0, -0.22, 0, 0, 0, 0, 1, 1, 1.03);
  k.mesh(armR.sh, k.torus(0.122, 0.01, 4, 12), M.gold, 0, -0.25, 0, 0, 0, 0, 1, 1, 1.03);

  // 左臂：袈裟袖披
  k.mesh(armL.sh, k.loft([
    { y: -0.2, rx: 0.148, rz: 0.145 },
    { y: -0.04, rx: 0.163, rz: 0.16 },
    { y: 0.1, rx: 0.155, rz: 0.155 },
  ], 8, false, false), M.robe);
  k.mesh(armL.sh, k.loft([{ y: -0.215, rx: 0.153, rz: 0.15 }, { y: -0.185, rx: 0.158, rz: 0.155 }], 8, false, false), M.gold);

  // 左肩石甲（随肩部分跟随）
  const pauld = k.joint(armL.clav, SH_OUT, -0.01, 0);
  {
    const p = k.joint(pauld, 0, 0, 0);
    p.rotation.z = -0.28;
    // 主甲：七棱切面的巨石穹顶（块面感强），底缘一圈青铜箍
    const P_SEG = 7;
    const P_PH = -0.12;
    const DOME: Ring[] = [
      { y: -0.02, rx: 0.262, rz: 0.282, cx: 0.035 },
      { y: 0.095, rx: 0.27, rz: 0.29, cx: 0.035 },
      { y: 0.185, rx: 0.205, rz: 0.225, cx: 0.03 },
      { y: 0.235, rx: 0.1, rz: 0.12, cx: 0.02 },
    ];
    k.mesh(p, k.loft(DOME, P_SEG, true, true, P_PH), M.stone);
    k.mesh(p, k.loft([
      { y: -0.06, rx: 0.276, rz: 0.296, cx: 0.035 },
      { y: 0.012, rx: 0.284, rz: 0.304, cx: 0.035 },
    ], P_SEG, true, true, P_PH), M.bronze);
    // 山形石脊：中峰高、两侧低，呼应「镇山」
    k.mesh(p, k.taper(0.19, 0.05, 0.36, 0.14, 0.1, 'bottom'), M.stoneDark, 0.035, 0.2, -0.02, 0.05, 0.12, -0.1);
    k.mesh(p, k.taper(0.12, 0.03, 0.16, 0.05, 0.075, 'bottom'), M.stoneDark, 0.12, 0.165, 0.12, 0.25, 0.4, -0.35);
    // 下层甲片
    const l1 = k.joint(p, 0.255, -0.06, 0);
    l1.rotation.z = -1.0;
    k.mesh(l1, k.taper(0.3, 0.27, 0.4, 0.36, 0.055), M.stoneDark);
    k.mesh(l1, k.box(0.3, 0.022, 0.41), M.bronze, 0, -0.032, 0);
    const l2 = k.joint(p, 0.3, -0.17, 0);
    l2.rotation.z = -1.22;
    k.mesh(l2, k.taper(0.26, 0.24, 0.36, 0.32, 0.05), M.stone);
    k.mesh(l2, k.box(0.26, 0.02, 0.37), M.bronze, 0, -0.03, 0);
    // 青铜圆钉 + 灵火符环（嵌在穹顶前外侧面上）
    loftPoint(DOME, P_SEG, P_PH, 0.42, 0.06, _v);
    loftNormal(DOME, P_SEG, P_PH, 0.42, 0.06, _n);
    const boss = k.joint(p, _v.x + _n.x * 0.004, _v.y, _v.z + _n.z * 0.004);
    boss.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), _n);
    k.mesh(boss, k.cyl(0.078, 0.086, 0.034, 8), M.bronze);
    k.mesh(boss, k.torus(0.054, 0.01, 4, 12), M.rune, 0, 0.018, 0);
    k.mesh(boss, k.octa(0.024), M.rune, 0, 0.022, 0, 0, 0, 0, 1, 0.6, 1);
    k.mesh(boss, k.ico(0.13, 0), M.halo, 0, 0.03, 0);
    // 甲面灵光裂纹：贴着穹顶切面的折线
    for (const [a0, a1, y0, y1] of [[0.75, 1.15, 0.07, 0.15], [1.15, 1.5, 0.15, 0.09], [0.2, 0.42, 0.135, 0.19], [0.0, 0.2, 0.165, 0.135]] as const) {
      const lo = (a: number): number => y0 + ((a - a0) / (a1 - a0)) * (y1 - y0) - 0.007;
      k.mesh(p, k.wrap(DOME, P_SEG, P_PH, Math.min(a0, a1), Math.max(a0, a1), 6, lo, (a) => lo(a) + 0.014, 1, 0.004), M.rune);
    }
  }

  // ───────────── 右手持枪：构建期 IK ─────────────
  const hand = k.joint(armR.hand, 0, 0, 0);
  hand.name = 'bear:gunMount';
  armR.hand.rotation.order = 'YXZ';

  // 待机基础姿势（左臂 / 左手）
  const L_SH_X = -0.06;
  const L_SH_Z = 0.2;
  const L_EL_X = -0.3;
  curl(armR.rig, 0.95);
  curl(armL.rig, 0.45);

  // 腿 IK
  const A2 = THIGH * THIGH;
  const B2 = SHIN * SHIN;
  const applyLegs = (liftY: number, liftZ: number): void => {
    for (let li = 0; li < legs.length; li++) {
      const L = legs[li];
      const hx = hips.position.x + L.hip.position.x;
      const hy = hips.position.y + L.hip.position.y;
      const hz = hips.position.z;
      const up = L.s > 0 ? liftY : 0;
      const dx = L.fx - hx;
      const dy = ANKLE_H + up - hy;
      const dz = L.fz + (L.s > 0 ? liftZ : 0) - hz;
      const splay = Math.atan2(dx, -dy);
      const lv = Math.sqrt(dx * dx + dy * dy);
      const D = clamp(Math.sqrt(lv * lv + dz * dz), 0.3, THIGH + SHIN - 0.002);
      const phi = Math.atan2(dz, lv);
      const alpha = Math.acos(clamp((A2 + D * D - B2) / (2 * THIGH * D), -1, 1));
      const bend = Math.PI - Math.acos(clamp((A2 + B2 - D * D) / (2 * THIGH * SHIN), -1, 1));
      L.hip.rotation.set(-(phi + alpha), 0, splay);
      L.knee.rotation.set(bend, 0, 0);
      L.ankle.rotation.set(phi + alpha - bend + up * 1.2, L.yaw, -splay);
    }
  };
  applyLegs(0, 0);
  armL.sh.rotation.set(L_SH_X, 0, L_SH_Z);
  armL.el.rotation.set(L_EL_X, 0, 0);
  root.updateMatrixWorld(true);

  // 枪的世界姿态：枪口朝前下方（GUN_DIR），枪背朝上；握把中心落在 GUN_GRIP
  const gunQ = new THREE.Quaternion();
  {
    const z = GUN_DIR.clone().negate();
    const y = new THREE.Vector3(0, 1, 0).addScaledVector(z, -z.y).normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    gunQ.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
  }
  const gripC = GUN_GRIP.clone();
  const gunO = gripC.clone().sub(new THREE.Vector3(0, -0.05, 0.06).applyQuaternion(gunQ));
  const gripUp = new THREE.Vector3(0, 0.9, -0.43).normalize().applyQuaternion(gunQ);
  const wrist = gripC.clone();
  const pole = new THREE.Vector3(-0.5, 0.0, -1).normalize();
  const tmpQ = new THREE.Quaternion();
  const tmpV = new THREE.Vector3();
  const tgtLocal = new THREE.Vector3();
  for (let it = 0; it < 6; it++) {
    tgtLocal.copy(wrist);
    armR.clav.worldToLocal(tgtLocal);
    solveArm(armR.sh, armR.el, tgtLocal, pole, UPPER, FORE);
    root.updateMatrixWorld(true);
    armR.el.getWorldQuaternion(tmpQ).invert();
    tmpV.copy(gripUp).applyQuaternion(tmpQ);
    armR.hand.rotation.set(Math.asin(clamp(-tmpV.y, -0.75, 0.75)), Math.atan2(tmpV.x, tmpV.z), 0);
    root.updateMatrixWorld(true);
    armR.hand.localToWorld(tmpV.set(GRIP_IN, -GRIP_DOWN, 0));
    wrist.add(tmpV.subVectors(gripC, tmpV));
  }
  const shRBase = armR.sh.quaternion.clone();
  const elRBase = armR.el.rotation.x;
  // 挂点：把枪的世界姿态换算到手的本地空间
  {
    const mw = new THREE.Matrix4().compose(gunO, gunQ, new THREE.Vector3(1, 1, 1));
    const inv = armR.hand.matrixWorld.clone().invert();
    mw.premultiply(inv);
    mw.decompose(hand.position, hand.quaternion, tmpV);
  }

  // ───────────── 动画状态 ─────────────
  let introT = -1;
  const ch = new Float32Array(N_CH);
  const carry = new Float32Array(N_CH);
  let carryW = 0;
  const sBead = new Spring(55, 8);
  const sTassel = new Spring(70, 7);
  const sFlap = [new Spring(170, 19), new Spring(170, 19), new Spring(90, 10), new Spring(90, 10)];
  const sRope = new Spring(60, 6);
  let prevHipY = HIP_Y;
  let first = true;

  const rig: HeroRig = {
    root,
    height: 2.22,
    hand,
    materials: k.mats,
    update(dt: number, t: number): void {
      // —— 亮相通道 ——
      if (introT >= 0) {
        introT += dt;
        if (introT >= INTRO_LEN) introT = -1;
      }
      const cw = carryW > 0 ? smooth01(carryW) : 0;
      if (carryW > 0) carryW = Math.max(0, carryW - dt / 0.3);
      for (let i = 0; i < N_CH; i++) ch[i] = (introT >= 0 ? track(TRACKS[i], introT) : 0) + carry[i] * cw;
      const sh = ch[CH_SH];

      // —— 呼吸（4.8 秒，胸 → 肩 → 头依次滞后）——
      const bp = (t * TAU) / 4.8;
      const br = 0.5 - 0.5 * Math.cos(bp);
      const brS = 0.5 - 0.5 * Math.cos(bp - 0.45);
      const brH = 0.5 - 0.5 * Math.cos(bp - 0.9);
      const sway = Math.sin(t * 0.55) + 0.35 * Math.sin(t * 1.27 + 0.6);

      hips.position.set(0.01 * sway + ch[CH_HX], HIP_Y - 0.012 * (1 - br) + ch[CH_HY] - 0.012 * sh, ch[CH_HZ]);
      spine.rotation.set(LEAN - 0.035 * br + ch[CH_SX] + 0.02 * sh, 0.025 * Math.sin(t * 0.31) + ch[CH_SY], -0.01 * sway + ch[CH_SZ]);
      const ce = ch[CH_CE];
      skin.scale.set(1 + 0.024 * br + ce * 0.6, 1 + 0.012 * br + ce * 0.2, 1 + 0.045 * br + ce);
      chest.position.set(0, CHEST_Y + 0.011 * br + ce * 0.12, 0.012 * br + ce * 0.2);
      armL.clav.rotation.set(0, 0, 0.065 * brS + 0.04 * sh);
      armR.clav.rotation.set(0, 0, -0.065 * brS - 0.03 * sh);

      // —— 腿：脚掌钉地 ——
      applyLegs(ch[CH_FLY], ch[CH_FLZ]);

      // —— 头：缓慢转头 + 停留，颈先头后 ——
      const lookN = track(LOOK, ((t % LOOK_LEN) + LOOK_LEN) % LOOK_LEN);
      const lookH = track(LOOK, (((t - 0.35) % LOOK_LEN) + LOOK_LEN) % LOOK_LEN);
      neck.rotation.set(-0.1 + 0.03 * brH + ch[CH_NX] + 0.04 * sh, 0.4 * lookN, 0);
      head.rotation.set(-0.02 + 0.05 * Math.abs(lookH) - 0.02 * brH + ch[CH_HDX] + 0.05 * sh, 0.6 * lookH + ch[CH_HDY], -0.04 * lookH);
      jaw.rotation.x = ch[CH_JAW];
      mouthG.visible = lowFangs.visible = jaw.rotation.x > 0.04;
      // 眨眼 / 抖耳
      const blink = 1 - pulse(t, 4.7, 1.3, 0.06, 0.04, 0.08) * 0.88;
      eyes[0].scale.y = 0.016 * blink;
      eyes[1].scale.y = 0.016 * blink;
      ears[0].rotation.x = -0.35 * pulse(t, 5.3, 0.8, 0.07, 0.03, 0.18);
      ears[1].rotation.x = -0.35 * pulse(t, 6.1, 3.4, 0.07, 0.03, 0.18);

      // —— 左臂：自然下垂 + 偶尔攥拳 ——
      const clench = Math.max(pulse(t, 7, 2.4, 0.3, 0.9, 0.7), ch[CH_CL]);
      armL.sh.rotation.set(L_SH_X + 0.018 * Math.sin(bp - 0.9) + ch[CH_LX], ch[CH_LY] + 0.08 * clench, L_SH_Z + 0.015 * brS + ch[CH_LZ]);
      armL.el.rotation.set(L_EL_X - 0.08 * clench + ch[CH_LE], 0, 0);
      armL.hand.rotation.set(0.08 + 0.1 * clench, 0.15 * clench, 0.06);
      curl(armL.rig, 0.45 + 0.55 * clench);

      // —— 右臂（持枪）：IK 基础姿态 + 砸击震颤 ——
      _q.setFromEuler(_e.set(-0.05 * sh, 0, 0));
      armR.sh.quaternion.copy(shRBase).multiply(_q);
      armR.el.rotation.x = elRBase + 0.03 * sh;

      // —— 肩甲：部分跟随左肩 + 震颤 ——
      pauld.rotation.set(armL.sh.rotation.x * 0.28, 0, (armL.sh.rotation.z - L_SH_Z) * 0.3 + 0.05 * sh);

      // —— 弹簧：念珠 / 流苏 / 下摆 / 垂绳 ——
      const sdt = Math.min(dt, 1 / 30);
      const pitch = spine.rotation.x;
      if (first) {
        sBead.reset(pitch);
        prevHipY = hips.position.y;
        first = false;
      }
      const lag = sBead.step(pitch, sdt);
      beadPivot.rotation.x = clamp(-(pitch - lag) * 1.1 - Math.max(0, pitch - 0.16) * 0.75 - 0.05 * sh, -0.48, 0.02);
      tassel.rotation.x = sTassel.step(-beadPivot.rotation.x * 0.6 + (pitch - LEAN) * 0.4, sdt);
      const thL = legs[0].hip.rotation.x;
      const thR = legs[1].hip.rotation.x;
      const fL = sFlap[0].step(Math.min(-0.06, thL * 1.02 + 0.09), sdt);
      const fR = sFlap[1].step(Math.min(-0.06, thR * 1.02 + 0.09), sdt);
      flapFL.up.rotation.x = fL;
      flapFR.up.rotation.x = fR;
      flapFL.lo.rotation.x = Math.max(0, -fL - 0.25);
      flapFR.lo.rotation.x = Math.max(0, -fR - 0.25);
      flapBL.up.rotation.x = sFlap[2].step(0.08 + Math.max(0, -thL - 0.25) * 0.3, sdt);
      flapBR.up.rotation.x = sFlap[3].step(0.08 + Math.max(0, -thR - 0.25) * 0.3, sdt);
      const vy = (hips.position.y - prevHipY) / Math.max(1e-4, dt);
      prevHipY = hips.position.y;
      ropeEnds.rotation.x = sRope.step(clamp(vy * 1.2, -0.7, 0.7), sdt);

      // —— 灵光：念珠随呼吸明灭，砸击时与肩甲符环一同闪亮 ——
      const gl = ch[CH_GL];
      const bg = 0.5 - 0.5 * Math.cos(bp - 0.7);
      M.beadGlow.color.copy(GLOW_C).multiplyScalar(0.5 + 0.4 * bg + 1.2 * gl);
      M.rune.color.copy(GLOW_C).multiplyScalar(0.42 + 0.18 * bg + 1.4 * gl);
      M.eye.color.copy(GLOW_C).multiplyScalar(1 + 0.4 * gl);
      M.halo.color.copy(GLOW_C).multiplyScalar(0.85 * gl * gl);
      M.beadHalo.color.copy(GLOW_C).multiplyScalar(0.05 + 0.06 * bg + 0.45 * gl);
    },
    playIntro(): void {
      if (introT >= 0) {
        for (let i = 0; i < N_CH; i++) carry[i] = ch[i];
        carryW = 1;
      }
      introT = 0;
    },
    dispose(): void {
      k.dispose();
    },
  };
  rig.update(0, 0);
  return rig;
}
