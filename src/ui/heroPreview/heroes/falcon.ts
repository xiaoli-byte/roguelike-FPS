/**
 * 雷隼 · 天穹猎手 —— 英雄选择舞台的程序化低多边形展示模型。
 *
 * 造型：兽首人身的隼族猎手（约 1.85 米含冠羽）。头是选人界面的辨识焦点（整体放大 1.15）：
 * 经纬网格雕塑的颅，按格着色出游隼的深色兜帽 + 眼下楔形「髭纹」+ 奶白颊斑 / 喉（花纹与表面齐平、分界是干净的棱线），
 * 厚重 V 形眉骨压住冰蓝发光眼，黄色蜡膜与放大的弯钩喙，脑后一束向后掠起的冠羽。
 * 奶白人字纹胸羽、墨蓝长款猎装风衣（朱红里衬、鎏金滚边）、黄铜肩甲与腰带；
 * 背后一对收拢的大翅膀（石板蓝灰，覆羽 / 次级飞羽 / 初级飞羽三层，浅色羽缘、羽缘雷光发光条）：
 * 翼腕高过肩头、立在头部两侧，羽尖向下收拢——剪影上宽下窄，一眼区别于其他英雄。
 * 右手低位警戒持左轮（枪在右胯外侧、枪口斜指前下），左手叉腰。
 *
 * 骨架：hips → spine → chest → neck → head；chest → 肩 → 肘 → 腕（右腕挂 hand）；hips → 髋 → 膝 → 踝；
 * chest → 翼根 → 翼臂 → 腕（羽片逐片挂关节，右翼为左翼的镜像）。
 * 持枪右臂每帧解两段 IK（低位警戒 ↔ 瞄准目标插值，腕路径向外侧拱出）；其余关节按曲线直接驱动。
 * 动画只改关节的 rotation / position / quaternion，update 内不分配对象。
 */
import * as THREE from 'three';
import { Geo } from '../../../enemies/Models';
import type { HeroRig } from './types';
import {
  FalconKit, armIK, clamp01, easeInOut, easeOut3, easeOutBack, edgeStripGeo, featherGeo, dirOf, frameQuat, grp, latLongGeo, loftGeo, mesh, shellGeo, smooth,
  type FeatherLevel, type Sec, type ShellRow,
} from './falconKit';

const TAU = Math.PI * 2;
const GLOW = 0x6fd8ff;

const C = {
  slate: 0x587196,
  slateDark: 0x3d4b60,
  cap: 0x242c39,
  cream: 0xeee3c8,
  creamShade: 0xddd0b2,
  bar: 0x666a76,
  coat: 0x212d4a,
  trim: 0xc89a46,
  lining: 0x7d2618,
  leather: 0x4a3426,
  glove: 0x33261f,
  boot: 0x2a201b,
  trouser: 0x5a5049,
  brass: 0xcda24c,
  steel: 0x3e4f6e,
  yellow: 0xf0b62c,
  beakBase: 0x9eacbf,
  beakMid: 0x5d6879,
  beakTip: 0x1d2027,
  claw: 0x1c1c22,
} as const;

// 骨架尺寸（米）
const HIP_Y = 0.95;
const THIGH = 0.42;
const SHIN = 0.42;
const UPPER_ARM = 0.28;
const FORE_ARM = 0.245;
const SHOULDER: [number, number, number] = [0.195, 0.205, -0.01];
/** 头部整体放大（选人界面里头是辨识焦点，略大于写实比例） */
const HEAD_S = 1.15;

const INTRO_LEN = 1.4;

// update 用临时变量（模块级复用，不在帧内分配）
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _col = new THREE.Color();

interface FeatherJ {
  g: THREE.Group;
  fold: number;
  open: number;
  /** 展开延迟（秒） */
  delay: number;
  /** 待机起伏相位 */
  ph: number;
  amp: number;
}

interface WingRig {
  wing: THREE.Group;
  arm: THREE.Group;
  hand: THREE.Group;
  feathers: FeatherJ[];
}

interface ArmPose {
  shoulder: THREE.Quaternion;
  elbow: number;
  wrist: THREE.Quaternion;
}

// 待机扭头日程（周期 6 秒）：[时刻, yaw, pitch, roll]——隼式离散「顿挫」转头。
// 整体略偏向角色右侧（舞台镜头在角色右前方约 27°），让它时常侧目看向玩家，而不是一直望向画面外。
const HEAD_KEYS: readonly [number, number, number, number][] = [
  [0.0, -0.1, 0.0, 0.0],
  [1.55, 0.32, -0.05, 0.05],
  [2.3, 0.12, 0.05, 0.0],
  [3.25, -0.42, 0.02, -0.1],
  [4.15, -0.24, -0.09, 0.2],
  [5.05, -0.08, 0.0, 0.0],
];
const HEAD_PERIOD = 6;

function headKey(tm: number, dur: number, out: THREE.Vector3): THREE.Vector3 {
  const m = ((tm % HEAD_PERIOD) + HEAD_PERIOD) % HEAD_PERIOD;
  let k = 0;
  for (let i = 0; i < HEAD_KEYS.length; i++) if (HEAD_KEYS[i][0] <= m) k = i;
  const cur = HEAD_KEYS[k];
  const prev = HEAD_KEYS[(k + HEAD_KEYS.length - 1) % HEAD_KEYS.length];
  const s = easeOut3((m - cur[0]) / dur);
  return out.set(prev[1] + (cur[1] - prev[1]) * s, prev[2] + (cur[2] - prev[2]) * s, prev[3] + (cur[3] - prev[3]) * s);
}
const _hk = new THREE.Vector3();

/** 0 → 1 → 0 的 sin² 鼓包（起止速度为零） */
function bump(x: number): number {
  const s = Math.sin(Math.PI * clamp01(x));
  return s * s;
}
const _hk2 = new THREE.Vector3();

export function buildFalconModel(): HeroRig {
  const K = new FalconKit();
  const root = new THREE.Group();
  root.name = 'hero:falcon';

  // ───────────── 材质（全部自建） ─────────────
  const mVC = K.std(0xffffff, 0.82, 0.02, { vertexColors: true });
  const mCap = K.std(C.cap, 0.8);
  const mCoat = K.std(C.coat, 0.78, 0.05);
  const mCoatVC = K.std(0xffffff, 0.78, 0.06, { vertexColors: true });
  const mLining = K.std(C.lining, 0.85, 0.02, { side: THREE.BackSide });
  const mInner = K.std(0x2a2226, 0.9, 0.02, { side: THREE.BackSide });
  const mRed = K.std(C.lining, 0.8, 0.02);
  const mLeather = K.std(C.leather, 0.7, 0.05);
  const mGlove = K.std(C.glove, 0.75, 0.05);
  const mBoot = K.std(C.boot, 0.7, 0.08);
  const mTrouser = K.std(C.trouser, 0.88, 0.02);
  const mBrass = K.std(C.brass, 0.38, 0.55);
  const mArmorVC = K.std(0xffffff, 0.45, 0.42, { vertexColors: true });
  const mYellow = K.std(C.yellow, 0.6, 0.02);
  const mClaw = K.std(C.claw, 0.45, 0.2);
  const mBeak = K.std(0xffffff, 0.45, 0.05, { vertexColors: true });
  const mWingBone = K.std(0x3c4759, 0.85);
  const mEye = K.glow(GLOW);
  const mAccent = K.glow(GLOW);
  const mStrips = [0, 1, 2].map(() => K.glow(GLOW, { side: THREE.DoubleSide }));
  const glowBase = new THREE.Color(GLOW);

  const own = <T extends THREE.BufferGeometry>(g: T): T => K.own(g);

  // ───────────── 骨架 ─────────────
  const hips = grp(root, 0, HIP_Y, 0);
  const spine = grp(hips, 0, 0.09, 0);
  const chest = grp(spine, 0, 0.16, 0);
  const neck = grp(chest, 0, 0.25, -0.005);
  const head = grp(neck, 0, 0.058, 0.022);

  // ───────────── 腿 ─────────────
  const thighGeo = own(loftGeo([
    [0, 0.07, 0, 0.152, 0.16],
    [0, -0.06, 0.006, 0.148, 0.158],
    [0, -0.26, 0.004, 0.122, 0.132],
    [0, -0.41, 0, 0.1, 0.108],
  ], { sides: 7 }));
  const bootGeo = own(loftGeo([
    [0, 0.065, 0.006, 0.14, 0.15],
    [0, 0.0, 0.004, 0.134, 0.14],
    [0, -0.03, 0.0, 0.116, 0.126],
    [0, -0.14, -0.008, 0.112, 0.126],
    [0, -0.33, 0.0, 0.086, 0.096],
    [0, -0.4, 0.006, 0.094, 0.104],
  ], { sides: 7 }));
  const footGeo = own(loftGeo([
    [0, -0.035, -0.07, 0.08, 0.09],
    [0, -0.04, -0.02, 0.092, 0.085],
    [0, -0.05, 0.06, 0.094, 0.062],
    [0, -0.056, 0.125, 0.084, 0.048],
    [0, -0.062, 0.168, 0.048, 0.03],
  ], { sides: 6 }));
  const toeCapGeo = own(loftGeo([
    [0, -0.052, 0.1, 0.092, 0.058],
    [0, -0.058, 0.14, 0.08, 0.046],
    [0, -0.064, 0.178, 0.04, 0.026],
  ], { sides: 6 }));
  const kneeGuardGeo = own(loftGeo([
    [0, 0.07, 0.07, 0.085, 0.03],
    [0, 0.0, 0.085, 0.1, 0.035],
    [0, -0.07, 0.075, 0.07, 0.025],
  ], { sides: 6 }));

  const buildLeg = (s: number): { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group } => {
    const hip = grp(hips, s * 0.095, -0.03, 0);
    mesh(hip, thighGeo, mTrouser);
    // 大腿外侧皮质束带
    mesh(hip, Geo.cyl(0.5, 0.5, 1, 8), mLeather, 0, -0.2, 0.002, 0, 0, 0, 0.136, 0.022, 0.146);
    mesh(hip, Geo.box(0.02, 0.03, 0.012), mBrass, s * 0.066, -0.2, 0.02);
    const knee = grp(hip, 0, -THIGH, 0);
    mesh(knee, kneeGuardGeo, mLeather);
    mesh(knee, Geo.box(0.05, 0.012, 0.012), mBrass, 0, 0.0, 0.103);
    mesh(knee, bootGeo, mBoot);
    // 靴筒翻边与黄铜扣带
    mesh(knee, Geo.cyl(0.5, 0.5, 1, 7), mLeather, 0, 0.045, 0.006, 0, 0, 0, 0.14, 0.035, 0.15);
    mesh(knee, Geo.cyl(0.5, 0.5, 1, 7), mBrass, 0, -0.2, -0.003, 0, 0, 0, 0.1, 0.014, 0.106);
    mesh(knee, Geo.box(0.022, 0.026, 0.01), mBrass, s * 0.05, -0.2, 0.012);
    const ankle = grp(knee, 0, -SHIN, 0);
    mesh(ankle, footGeo, mBoot);
    mesh(ankle, toeCapGeo, mBrass);
    mesh(ankle, Geo.box(0.096, 0.016, 0.25), mClaw, 0, -0.074, 0.05);
    // 隼爪：靴尖三枚黑爪
    for (let i = -1; i <= 1; i++) {
      mesh(ankle, Geo.cone(0.009, 0.04, 4), mClaw, i * 0.024, -0.068, 0.188 - Math.abs(i) * 0.012, 1.75, 0, -i * 0.25);
    }
    return { hip, knee, ankle };
  };
  const legL = buildLeg(1);
  const legR = buildLeg(-1);

  // ───────────── 骨盆 / 腰带 / 朱红腰巾 ─────────────
  mesh(hips, own(loftGeo([
    [0, 0.12, 0, 0.285, 0.19],
    [0, 0.0, 0, 0.305, 0.205],
    [0, -0.08, 0.005, 0.29, 0.19],
    [0, -0.14, 0.012, 0.19, 0.14],
  ], { sides: 8 })), mTrouser);
  mesh(hips, Geo.cyl(0.5, 0.5, 1, 12), mLeather, 0, 0.072, 0, 0, 0, 0, 0.318, 0.058, 0.228);
  mesh(hips, Geo.cyl(0.5, 0.5, 1, 12), mRed, 0, 0.03, 0.002, 0, 0, 0, 0.33, 0.034, 0.238);
  // 鎏金带扣 + 雷纹宝石
  mesh(hips, Geo.box(0.07, 0.056, 0.016), mBrass, 0, 0.072, 0.117);
  mesh(hips, Geo.octa(0.017), mAccent, 0, 0.072, 0.128, 0, 0, 0);
  for (let i = 0; i < 6; i++) {
    const a = 0.55 + i * 0.42;
    mesh(hips, Geo.box(0.014, 0.014, 0.008), mBrass, Math.sin(a) * 0.16, 0.072, Math.cos(a) * 0.115, 0, a, 0);
    mesh(hips, Geo.box(0.014, 0.014, 0.008), mBrass, -Math.sin(a) * 0.16, 0.072, Math.cos(a) * 0.115, 0, -a, 0);
  }
  // 左后腰弹药小包、右胯空枪套
  const pouch = grp(hips, 0.13, 0.03, -0.09, 0, 0.9, 0);
  mesh(pouch, Geo.box(0.07, 0.07, 0.04), mLeather);
  mesh(pouch, Geo.box(0.074, 0.03, 0.044), mLeather, 0, 0.025, 0.002);
  mesh(pouch, Geo.box(0.012, 0.016, 0.006), mBrass, 0, 0.012, 0.025);
  const holster = grp(hips, -0.175, 0.0, 0.0, 0.12, 0, 0.06);
  mesh(holster, own(loftGeo([
    [0, 0.04, 0, 0.034, 0.075],
    [0, -0.06, 0.006, 0.036, 0.06],
    [0, -0.2, 0.018, 0.026, 0.04],
  ], { sides: 6 })), mLeather);
  mesh(holster, Geo.box(0.04, 0.012, 0.08), mBrass, 0, 0.0, 0.002);
  // 腰巾结与垂带（左胯）
  const knot = grp(hips, 0.158, 0.03, 0.06, 0, 0.6, 0);
  mesh(knot, Geo.ico(0.03, 0), mRed, 0, 0, 0, 0, 0, 0, 1, 0.8, 0.7);
  const sashTail = (x: number, len: number, rz: number): THREE.Group => {
    const g = grp(knot, x, -0.01, 0.005, 0, 0, rz);
    mesh(g, own(loftGeo([
      [0, 0, 0, 0.04, 0.012],
      [0.004, -len * 0.5, 0.004, 0.05, 0.012],
      [0.006, -len, 0.0, 0.034, 0.01],
    ], { sides: 4, rot: Math.PI / 4 })), mRed);
    mesh(g, Geo.box(0.036, 0.012, 0.012), mBrass, 0.006, -len + 0.005, 0);
    return g;
  };
  const sashA = sashTail(0.0, 0.3, 0.05);
  const sashB = sashTail(0.02, 0.22, 0.2);

  // ───────────── 风衣下摆（左半 + 镜像右半） ─────────────
  const skirtRows: ShellRow[] = [
    { y: 0.0, rx: 0.152, rz: 0.108, a0: 0.2, a1: Math.PI - 0.04 },
    { y: -0.1, rx: 0.178, rz: 0.134, a0: 0.26, a1: Math.PI - 0.05 },
    { y: -0.23, rx: 0.214, rz: 0.164, a0: 0.33, a1: Math.PI - 0.07, fold: 0.025 },
    { y: -0.39, rx: 0.242, rz: 0.19, a0: 0.42, a1: Math.PI - 0.1, fold: 0.045 },
    { y: -0.55, rx: 0.268, rz: 0.212, a0: 0.5, a1: Math.PI - 0.13, fold: 0.06 },
    { y: -0.615, rx: 0.275, rz: 0.218, a0: 0.53, a1: Math.PI - 0.14, fold: 0.062 },
    { y: -0.64, rx: 0.278, rz: 0.221, a0: 0.545, a1: Math.PI - 0.145, fold: 0.063 },
  ];
  const SK_COLS = 13;
  const skirtGeo = own(shellGeo(skirtRows, SK_COLS, (i, j) => {
    if (i === 5) return C.trim;
    if (j === 0) return C.trim;
    if (i === 4 && j % 4 === 1) return 0x2a3656;
    return C.coat;
  }));
  const skirtL = grp(hips, 0, 0.065, 0);
  const skirtRm = grp(hips, 0, 0.065, 0);
  skirtRm.scale.x = -1;
  for (const g of [skirtL, skirtRm]) {
    mesh(g, skirtGeo, mCoatVC);
    mesh(g, skirtGeo, mLining);
  }

  // ───────────── 上身：风衣躯干 ─────────────
  const torsoSecs: Sec[] = [
    [0, 0.285, -0.005, 0.13, 0.11],
    [0, 0.255, -0.01, 0.27, 0.16, 0.17],
    [0, 0.2, 0.0, 0.39, 0.22, 0.2],
    [0, 0.12, 0.015, 0.37, 0.25, 0.2],
    [0, 0.02, 0.012, 0.33, 0.225, 0.19],
    [0, -0.08, 0.005, 0.282, 0.2, 0.18],
    [0, -0.17, 0.0, 0.272, 0.19, 0.18],
  ];
  mesh(chest, own(loftGeo(torsoSecs, { sides: 10, axis: [0, -1, 0] })), mCoat);
  /** 躯干在高度 y 处的前半椭圆（rx、前向 rz、中心 z） */
  const torsoAt = (y: number): { rx: number; rz: number; cz: number } => {
    for (let i = 0; i < torsoSecs.length - 1; i++) {
      const a = torsoSecs[i];
      const b = torsoSecs[i + 1];
      if (y <= a[1] && y >= b[1]) {
        const f = (a[1] - y) / (a[1] - b[1]);
        return { rx: (a[3] + (b[3] - a[3]) * f) / 2, rz: (a[4] + (b[4] - a[4]) * f) / 2, cz: a[2] + (b[2] - a[2]) * f };
      }
    }
    const l = torsoSecs[torsoSecs.length - 1];
    return { rx: l[3] / 2, rz: l[4] / 2, cz: l[2] };
  };
  // 胸羽（奶白、下半带深色横纹）：贴着躯干前面的 V 形薄壳
  const bibSpan: [number, number][] = [
    [0.272, 0.66], [0.25, 0.64], [0.2, 0.52], [0.15, 0.47], [0.11, 0.43], [0.098, 0.42], [0.07, 0.385], [0.058, 0.37], [0.03, 0.34], [0.018, 0.325],
    [-0.01, 0.29], [-0.022, 0.27], [-0.05, 0.23], [-0.062, 0.21], [-0.09, 0.165], [-0.102, 0.145], [-0.15, 0.05],
  ];
  /** 横纹行（细行）：奇数格是深色短划，形成一排排断续的横斑 */
  const BAR_ROWS = new Set([4, 6, 8, 10, 12, 14]);
  /** 下半胸羽的横纹做成向下的人字形 */
  const bibTilt = (y: number): number => (y > 0.12 ? 0 : 0.07);
  const bibRows: ShellRow[] = bibSpan.map(([y, a]) => {
    const s = torsoAt(y);
    return { y, rx: s.rx * 1.05, rz: s.rz * 1.05, cz: s.cz, a0: -a, a1: a, tilt: bibTilt(y) };
  });
  // 细行是浅米色人字纹（层层羽缘），下胸细行里再点缀逐行错位的稀疏小横斑（隼的胸腹横纹，而不是一排排「肋骨」）
  const BIB_COLS = 12;
  mesh(chest, own(shellGeo(bibRows, BIB_COLS, (i, j) => {
    if (!BAR_ROWS.has(i)) return C.cream;
    return i >= 8 && j > 0 && j < BIB_COLS - 1 && (j + (i >> 1)) % 3 === 0 ? C.bar : C.creamShade;
  })), mVC);
  // 翻领（朱红里衬外翻）+ 鎏金边
  const lapelRows = (inner: number, outer: number, scale: number): ShellRow[] => bibSpan.map(([y, a], i) => {
    const s = torsoAt(y);
    const w = 0.24 - (0.25 - y) * 0.5;
    return { y, rx: s.rx * scale, rz: s.rz * scale, cz: s.cz, a0: a - inner, a1: a + Math.max(0.04, w) * outer, tilt: bibTilt(y) };
  });
  const lapelGeo = own(shellGeo(lapelRows(0.03, 1, 1.075), 2));
  const lapelTrimGeo = own(shellGeo(lapelRows(-0.0, 0.25, 1.085).map((r) => ({ ...r, a0: r.a0 + 0.02 })), 1));
  for (const sx of [1, -1]) {
    const g = grp(chest);
    g.scale.x = sx;
    mesh(g, lapelGeo, mRed);
    mesh(g, lapelTrimGeo, mBrass);
  }
  // 斜挎皮带（左肩 → 右腰）
  const strapPts: Sec[] = [];
  for (let i = 0; i <= 6; i++) {
    const f = i / 6;
    const y = 0.205 - f * 0.34;
    const x = 0.15 - f * 0.29;
    const s = torsoAt(y);
    const ex = Math.min(0.97, Math.abs(x) / (s.rx * 1.09));
    const z = s.cz + s.rz * 1.1 * Math.sqrt(1 - ex * ex) + 0.006;
    strapPts.push([x, y, z, 0.017, 0.06]);
  }
  mesh(chest, own(loftGeo(strapPts, { sides: 4, rot: Math.PI / 4, hint: [0.6, 0.8, 0] })), mLeather);
  {
    const p = strapPts[3];
    mesh(chest, Geo.box(0.044, 0.04, 0.012), mBrass, p[0], p[1], p[2] + 0.006, 0, 0, 0.7);
    mesh(chest, Geo.octa(0.011), mAccent, p[0], p[1], p[2] + 0.014);
  }
  // 翻领边的鎏金盘扣（三对）
  const bibA = (y: number): number => {
    for (let i = 0; i < bibSpan.length - 1; i++) {
      const [y0, a0] = bibSpan[i];
      const [y1, a1] = bibSpan[i + 1];
      if (y <= y0 && y >= y1) return a0 + ((a1 - a0) * (y0 - y)) / (y0 - y1);
    }
    return 0;
  };
  for (const y of [0.15, 0.075, 0.0]) {
    const s = torsoAt(y);
    const a = bibA(y) + 0.035;
    for (const sx of [1, -1]) {
      const px = sx * Math.sin(a) * s.rx * 1.09;
      const py = y + bibTilt(y) * a;
      const pz = s.cz + Math.cos(a) * s.rz * 1.09;
      mesh(chest, Geo.ico(0.011, 0), mBrass, px, py, pz + 0.004);
      mesh(chest, Geo.box(0.03, 0.007, 0.007), mBrass, px + sx * 0.018, py, pz - 0.002, 0, -sx * a, 0);
    }
  }
  // 立领（外墨蓝、里朱红）
  const collarGeo = own(shellGeo([
    { y: 0.385, rx: 0.122, rz: 0.11, cz: -0.03, a0: 0.95, a1: TAU - 0.95 },
    { y: 0.33, rx: 0.104, rz: 0.094, cz: -0.022, a0: 0.85, a1: TAU - 0.85 },
    { y: 0.265, rx: 0.13, rz: 0.1, cz: -0.012, a0: 0.75, a1: TAU - 0.75 },
  ], 12, (i) => (i === 0 ? C.trim : C.coat)));
  mesh(chest, collarGeo, mCoatVC);
  mesh(chest, collarGeo, mLining);

  // ───────────── 肩甲（左 + 镜像右） ─────────────
  const pauldronGeo = own(shellGeo([
    { y: 0.055, rx: 0.02, rz: 0.022, a0: 0, a1: TAU },
    { y: 0.045, rx: 0.07, rz: 0.076, a0: 0, a1: TAU },
    { y: 0.012, rx: 0.102, rz: 0.108, a0: 0, a1: TAU },
    { y: -0.026, rx: 0.114, rz: 0.12, a0: 0, a1: TAU },
    { y: -0.04, rx: 0.117, rz: 0.123, a0: 0, a1: TAU },
  ], 10, (i) => (i === 3 ? C.brass : i === 0 ? 0x5a6a84 : C.steel)));
  const lameGeo = own(shellGeo([
    { y: -0.035, rx: 0.112, rz: 0.116, a0: -1.9, a1: 1.9 },
    { y: -0.075, rx: 0.12, rz: 0.124, a0: -1.9, a1: 1.9 },
    { y: -0.085, rx: 0.121, rz: 0.125, a0: -1.9, a1: 1.9 },
  ], 8, (i) => (i === 1 ? C.brass : C.steel)));
  const pauldrons: THREE.Group[] = [];
  for (const sx of [1, -1]) {
    const mir = grp(chest);
    mir.scale.x = sx;
    const pg = grp(mir, SHOULDER[0] + 0.012, SHOULDER[1] + 0.03, SHOULDER[2]);
    const tilt = grp(pg, 0, 0, 0, 0, 0, -0.42);
    mesh(tilt, pauldronGeo, mArmorVC);
    mesh(tilt, pauldronGeo, mInner);
    const lame = grp(tilt, 0.012, -0.012, 0, 0, Math.PI / 2, 0);
    mesh(lame, lameGeo, mArmorVC);
    mesh(lame, lameGeo, mInner);
    // 甲面雷纹
    mesh(tilt, Geo.box(0.07, 0.006, 0.01), mAccent, 0.01, 0.04, 0.07, -0.5, 0, 0);
    mesh(tilt, Geo.box(0.012, 0.012, 0.012), mBrass, 0.0, 0.058, 0.0);
    pauldrons.push(pg);
  }

  // ───────────── 手臂 ─────────────
  const upperGeo = own(loftGeo([
    [0, 0.045, 0, 0.124, 0.13],
    [0, -0.06, 0.0, 0.114, 0.12],
    [0, -0.2, 0.0, 0.096, 0.1],
    [0, -0.29, 0.0, 0.088, 0.092],
  ], { sides: 7 }));
  const cuffGeo = own(loftGeo([
    [0, 0.03, 0, 0.084, 0.088],
    [0, -0.04, 0.0, 0.096, 0.098],
    [0, -0.075, 0.0, 0.104, 0.104],
  ], { sides: 7 }));
  const bracerGeo = own(loftGeo([
    [0, -0.05, 0, 0.088, 0.09],
    [0, -0.14, 0, 0.076, 0.078],
    [0, -0.225, 0, 0.064, 0.066],
  ], { sides: 7 }));
  const palmGeo = own(loftGeo([
    [0, 0.012, 0, 0.05, 0.04],
    [0, -0.045, 0, 0.074, 0.034],
    [0, -0.082, 0, 0.068, 0.028],
  ], { sides: 6, hint: [0, 0, 1] }));

  const fingerGeo = (curl: number, len: number): THREE.BufferGeometry => {
    const pts: Sec[] = [];
    let x = 0;
    let y = 0;
    const segs = [len * 0.4, len * 0.33, len * 0.27];
    const ws = [0.019, 0.017, 0.015, 0.011];
    pts.push([0, 0, 0, ws[0], ws[0]]);
    let a = 0;
    for (let i = 0; i < 3; i++) {
      a += curl * (i === 2 ? 0.7 : 0.9 + i * 0.1);
      x += Math.sin(a) * segs[i];
      y -= Math.cos(a) * segs[i];
      pts.push([x, y, 0, ws[i + 1], ws[i + 1]]);
    }
    return own(loftGeo(pts, { sides: 5, hint: [0, 0, 1] }));
  };
  const fistFinger = fingerGeo(1.0, 0.075);
  const relaxFinger = fingerGeo(0.75, 0.08);
  const thumbGeo = own(loftGeo([
    [0, 0, 0, 0.022, 0.022],
    [0.012, -0.024, 0.01, 0.02, 0.02],
    [0.02, -0.046, 0.008, 0.017, 0.017],
    [0.024, -0.064, 0.0, 0.012, 0.012],
  ], { sides: 5, hint: [0, 0, 1] }));

  const buildArm = (s: number): { shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group } => {
    const shoulder = grp(chest, s * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    mesh(shoulder, upperGeo, mCoat);
    const elbow = grp(shoulder, 0, -UPPER_ARM, 0);
    mesh(elbow, Geo.ico(0.045, 0), mCoat, 0, 0.0, 0);
    mesh(elbow, cuffGeo, mCoat);
    mesh(elbow, Geo.cyl(0.5, 0.5, 1, 7), mBrass, 0, -0.072, 0, 0, 0, 0, 0.106, 0.012, 0.106);
    mesh(elbow, bracerGeo, mLeather);
    mesh(elbow, Geo.cyl(0.5, 0.5, 1, 7), mBrass, 0, -0.12, 0, 0, 0, 0, 0.084, 0.012, 0.086);
    mesh(elbow, Geo.cyl(0.5, 0.5, 1, 7), mBrass, 0, -0.205, 0, 0, 0, 0, 0.07, 0.012, 0.072);
    // 护臂外侧雷光线
    mesh(elbow, Geo.box(0.006, 0.075, 0.012), mAccent, s * 0.041, -0.162, 0, 0, 0, -s * 0.07);
    const wrist = grp(elbow, 0, -FORE_ARM, 0);
    return { shoulder, elbow, wrist };
  };

  /** 手：palm 朝 p·X（p = −s，自然下垂时掌心朝身体中线），四指沿 −Y，拇指在 +Z 侧 */
  const buildHand = (wrist: THREE.Group, s: number, fist: boolean): void => {
    const p = -s;
    const hg = grp(wrist);
    hg.scale.x = p; // 手指几何按 p = +1 建，镜像得到另一侧
    mesh(hg, palmGeo, mGlove, 0.004, 0, 0);
    mesh(hg, Geo.box(0.012, 0.03, 0.06), mBrass, -0.016, -0.05, 0);
    const fg = fist ? fistFinger : relaxFinger;
    const zs = [0.026, 0.009, -0.008, -0.024];
    zs.forEach((z, i) => {
      const f = mesh(hg, fg, mGlove, 0.004, -0.08 + (i === 0 || i === 3 ? 0.004 : 0), z);
      if (i === 3) f.scale.set(0.9, 0.85, 0.9);
    });
    if (!fist) {
      // 松握时露出的黑色爪尖
      for (const z of zs) mesh(hg, Geo.cone(0.006, 0.02, 4), mClaw, 0.05, -0.108, z, 0, 0, 2.6);
    }
    mesh(hg, thumbGeo, mGlove, 0.01, -0.012, 0.028);
    mesh(hg, Geo.cone(0.006, 0.018, 4), mClaw, 0.035, -0.083, 0.028, 0, 0, 2.7);
  };

  const armL = buildArm(1);
  const armR = buildArm(-1);
  buildHand(armL.wrist, 1, false);
  buildHand(armR.wrist, -1, true);

  // 右手持枪挂点（原点 = 握把顶部，−Z = 枪口，+Y = 枪顶）：枪口沿前臂（腕 −Y）、枪顶朝拇指（腕 +Z），握把落在掌心
  const hand = new THREE.Group();
  hand.name = 'falcon:hand';
  hand.position.set(0.04, -0.092, 0.05);
  hand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0),
  ));
  armR.wrist.add(hand);

  // ───────────── 手臂姿势（IK 预计算：胸腔空间） ─────────────
  const pose = (s: number, W: THREE.Vector3, pole: THREE.Vector3, fwd: THREE.Vector3, up: THREE.Vector3): ArmPose => {
    const S = new THREE.Vector3(s * SHOULDER[0], SHOULDER[1], SHOULDER[2]);
    const q1 = new THREE.Quaternion();
    const elbow = armIK(S, W, UPPER_ARM, FORE_ARM, pole, q1);
    const qe = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), elbow);
    const qh = frameQuat(fwd, up, new THREE.Quaternion());
    const wrist = q1.clone().multiply(qe).invert().multiply(qh);
    return { shoulder: q1, elbow, wrist };
  };
  const V = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
  const lIdle = pose(1, V(0.215, -0.12, 0.025), V(1, -0.1, 0.25), V(-0.3, -1, 0.12), V(0, 0.15, 1));
  // 右臂（持枪）每帧解 IK：在「低位警戒」与「瞄准」两组目标（腕位置 W / 肘向 pole / 枪口 fwd / 枪顶 up）之间插值，
  // 腕的路径向外侧拱出——抬枪 / 收枪时枪从身体右侧划过，不会横扫胸前。
  //  - 低位警戒：枪在右胯外侧、枪口斜指前下方，从舞台机位（右前方）看枪身是侧影，不压在腰带扣上
  //  - 瞄准：右肩送前（胸腔扭转）、手臂几乎伸直，枪口指向正前略偏左略向下、胸口高度（舞台低机位看枪身也在喙下方、不挡脸）——舞台机位在角色右前方 27°，
  //    这个方向的枪身与视线约成 40°，读得出长度，也不会正对镜头缩成一团
  const R_IDLE = { W: V(-0.262, -0.25, 0.12), pole: V(-1, 0.1, -0.7), fwd: V(-0.1, -0.72, 0.69), up: V(0, 0.7, 0.72) };
  const R_AIM = { W: V(-0.205, -0.025, 0.46), pole: V(-0.5, -1, -0.15), fwd: V(-0.1, -0.14, 1), up: V(0, 1, 0) };
  const rS = V(-SHOULDER[0], SHOULDER[1], SHOULDER[2]);
  const rW = new THREE.Vector3();
  const rPole = new THREE.Vector3();
  const rFwd = new THREE.Vector3();
  const rUp = new THREE.Vector3();
  const rQe = new THREE.Quaternion();
  const rQh = new THREE.Quaternion();
  const AXIS_X = V(1, 0, 0);
  const solveRightArm = (k: number, br: number): void => {
    const arc = Math.sin(Math.PI * k);
    rW.lerpVectors(R_IDLE.W, R_AIM.W, k);
    rW.x -= 0.07 * arc;
    rW.z += 0.03 * arc;
    rW.y += 0.004 * br;
    rPole.lerpVectors(R_IDLE.pole, R_AIM.pole, k).normalize();
    rFwd.lerpVectors(R_IDLE.fwd, R_AIM.fwd, k).normalize();
    rUp.lerpVectors(R_IDLE.up, R_AIM.up, k).normalize();
    const sh = armR.shoulder.quaternion;
    const el = armIK(rS, rW, UPPER_ARM, FORE_ARM, rPole, sh);
    armR.elbow.rotation.set(el, 0, 0);
    frameQuat(rFwd, rUp, rQh);
    armR.wrist.quaternion.copy(sh).multiply(rQe.setFromAxisAngle(AXIS_X, el)).invert().multiply(rQh);
  };

  // ───────────── 颈与头 ─────────────
  // 颈：前侧奶白（接下巴与胸羽）、后颈深色（接兜帽）
  mesh(neck, own(shellGeo([
    { y: 0.12, rx: 0.056, rz: 0.06, cz: 0.018, a0: -Math.PI, a1: Math.PI },
    { y: 0.04, rx: 0.06, rz: 0.062, cz: 0.004, a0: -Math.PI, a1: Math.PI },
    { y: -0.04, rx: 0.068, rz: 0.066, cz: -0.008, a0: -Math.PI, a1: Math.PI },
  ], 12, (_i, j) => (Math.abs(-Math.PI + ((j + 0.5) * TAU) / 12) < 1.75 ? C.cream : C.slateDark))), mVC);

  // 颅：按方向形变的低模椭球（前脸收成楔形、平顶、下颊饱满），按面着色——
  // 深色兜帽（含眼下垂到下颌的楔形「髭纹」）+ 奶白下巴 / 喉 / 髭纹后的颊斑。花纹与表面齐平。
  head.scale.setScalar(HEAD_S);
  const HC = new THREE.Vector3(0, 0.118, -0.012);
  const headAt = (n: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 => {
    const fz = Math.max(0, n.z);
    let x = n.x * 0.104 * (1 - 0.22 * fz * fz);
    let y = n.y * (n.y > 0 ? 0.112 : 0.118);
    let z = n.z * (n.z > 0 ? 0.13 : 0.1);
    if (n.y > 0.45) y -= (n.y - 0.45) * 0.035;
    if (n.y < 0) x *= 1 + 0.12 * -n.y * Math.abs(n.x);
    if (n.z < 0 && n.y > 0.2) y -= (n.y - 0.2) * n.z * -0.03; // 后脑压低，头顶从前向后下斜
    // 下颌收成锥形并入喉部（底面朝侧而不是朝下，不会被台面的反光染成一圈青灰）
    if (n.y < -0.45) {
      const k = (-n.y - 0.45) / 0.55;
      x *= 1 - 0.3 * k;
      z = z * (1 - 0.3 * k) + 0.012 * k;
      y *= 1 + 0.12 * k;
    }
    // 眉区前凸：额头顺势压向蜡膜（侧脸是一条从头顶斜下到喙根的直线）
    if (n.z > 0.6 && n.y > -0.1) z += 0.012 * (n.z - 0.6) / 0.4 * Math.min(1, (n.y + 0.1) / 0.4);
    return out.set(HC.x + x, HC.y + y, HC.z + z);
  };
  const headDir = dirOf;
  const headColor = (n: THREE.Vector3): number => {
    const az = Math.atan2(Math.abs(n.x), n.z);
    const el = n.y;
    if (az < 0.42) return el < -0.22 ? C.cream : C.cap; // 额头 / 下巴喉部
    // 髭纹：眼下的楔形，后缘随高度向前收（上宽下窄），下端止于下颌
    const back = el > -0.22 ? 0.96 : el > -0.45 ? 0.82 : 0.68;
    if (az < back) return el < -0.72 ? C.cream : C.cap;
    if (az < 1.9) return el < (az < 1.3 ? 0.0 : -0.2) ? C.cream : C.cap; // 颊斑
    return az > 2.4 && el < -0.3 ? C.slateDark : C.cap; // 后颈
  };
  // 经纬断点 = 花纹分界（方位：0 正前 → π 正后；仰角：−π/2 → π/2）
  const HEAD_AZ = [0, 0.21, 0.42, 0.55, 0.68, 0.82, 0.96, 1.13, 1.3, 1.6, 1.9, 2.4, 2.8, Math.PI];
  const HEAD_EL = [-Math.PI / 2, -1.15, -0.9, -0.72, -0.45, -0.22, 0.0, 0.2, 0.42, 0.68, 0.98, 1.3, Math.PI / 2];
  mesh(head, own(latLongGeo(HEAD_AZ, HEAD_EL, headAt, headColor)), mVC);
  // 眼：黄色眼圈 + 冰蓝发光虹膜 + 黑瞳，略偏向两侧；厚重的 V 形眉骨压住眼圈上缘（隼的凶光）
  const EYE_AZ = 0.62;
  const EYE_EL = 0.07;
  const eyeP = new THREE.Vector3();
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  for (const sx of [1, -1]) {
    headAt(headDir(sx * EYE_AZ, EYE_EL, eyeP), eyeP);
    const eye = grp(head, eyeP.x, eyeP.y, eyeP.z - 0.004, -0.08, sx * 0.74, 0);
    mesh(eye, Geo.cyl(0.0285, 0.03, 0.014, 8), mYellow, 0, 0, 0, Math.PI / 2, 0, 0);
    mesh(eye, Geo.ico(0.0215, 1), mEye, 0, 0, 0.002);
    mesh(eye, Geo.ico(0.0095, 0), mClaw, 0, 0, 0.02);
    mesh(eye, Geo.box(0.006, 0.006, 0.004), mEye, sx * -0.007, 0.008, 0.024);
    // 眉骨：贴着颅面从喙根上方斜向后上（内低外高），中段最厚、外凸压住眼圈上缘
    const browSecs: Sec[] = ([
      // az, el, 竖厚, 外凸
      [0.08, 0.17, 0.012, 0.018],
      [0.3, 0.24, 0.026, 0.034],
      [0.58, 0.29, 0.032, 0.038],
      [0.86, 0.31, 0.024, 0.026],
      [1.12, 0.29, 0.01, 0.012],
    ] as const).map(([az, el, w, h]): Sec => {
      const p = headAt(headDir(sx * az, el, _v1), _v2);
      _v1.subVectors(p, HC).normalize();
      return [p.x + _v1.x * 0.006, p.y + _v1.y * 0.006, p.z + _v1.z * 0.006, w, h];
    });
    mesh(head, own(loftGeo(browSecs, { sides: 5, hint: [0, 1, 0] })), mCap);
    // 鼻孔
    mesh(head, Geo.ico(0.0065, 0), mClaw, sx * 0.024, 0.114, 0.13);
  }
  // 蜡膜（黄）+ 上喙（蓝灰 → 黑色钩尖）+ 下喙：比例放大，从侧面看是一枚明确的弯钩
  mesh(head, own(loftGeo([
    [0, 0.106, 0.1, 0.076, 0.066],
    [0, 0.105, 0.134, 0.066, 0.058],
  ], { sides: 6, rot: Math.PI / 2 })), mYellow);
  mesh(head, own(loftGeo([
    [0, 0.104, 0.124, 0.066, 0.056, undefined, C.beakBase],
    [0, 0.099, 0.158, 0.056, 0.05, undefined, C.beakBase],
    [0, 0.087, 0.19, 0.043, 0.041, undefined, C.beakMid],
    [0, 0.064, 0.214, 0.03, 0.032, undefined, C.beakTip],
    [0, 0.036, 0.222, 0.019, 0.02, undefined, C.beakTip],
    [0, 0.01, 0.212, 0.004, 0.005, undefined, C.beakTip],
  ], { sides: 6, rot: Math.PI / 2 })), mBeak);
  mesh(head, own(loftGeo([
    [0, 0.07, 0.11, 0.054, 0.028, undefined, C.yellow],
    [0, 0.06, 0.158, 0.036, 0.02, undefined, C.beakBase],
    [0, 0.052, 0.186, 0.011, 0.008, undefined, C.beakMid],
  ], { sides: 5, rot: Math.PI / 2 })), mBeak);
  // 冠羽：脑后一束向后上方掠起的长羽（延长侧面剪影），最长两根羽缘带雷光
  const crestLv: FeatherLevel[] = [
    { y: 0, wl: 0.18, wr: 0.18, t: 0.06, c: C.cap },
    { y: -0.25, wl: 0.32, wr: 0.32, t: 0.07, c: C.cap },
    { y: -0.6, wl: 0.28, wr: 0.28, t: 0.05, c: C.slateDark },
    { y: -0.85, wl: 0.16, wr: 0.16, t: 0.03, c: C.slate },
    { y: -1, wl: 0, wr: 0, t: 0, c: C.slate },
  ];
  const crestGeo = own(featherGeo(crestLv));
  const crestStrip = own(edgeStripGeo(crestLv, 1, 0.07, 1));
  const crest = grp(head, 0, 0.2, -0.075);
  const crestDefs: [number, number, number, number, number][] = [
    // rx（仰角 = rx − π/2）, rz（左右张开）, 长, 宽, 前后
    [2.02, 0, 0.27, 0.07, 0],
    [1.92, 0.2, 0.23, 0.064, 0.012],
    [1.92, -0.2, 0.23, 0.064, 0.012],
    [1.8, 0.38, 0.18, 0.056, 0.024],
    [1.8, -0.38, 0.18, 0.056, 0.024],
    [2.25, 0.12, 0.15, 0.05, -0.02],
    [2.25, -0.12, 0.15, 0.05, -0.02],
  ];
  crestDefs.forEach(([rx, rz, L, w, dz], i) => {
    const g = grp(crest, 0, -Math.abs(dz) * 0.5, dz, rx, 0, rz);
    const inner = grp(g, 0, 0, 0, 0, Math.PI / 2, 0);
    mesh(inner, crestGeo, mVC, 0, 0, 0, 0, 0, 0, w, L, 0.12);
    if (i < 3) mesh(inner, crestStrip, mStrips[i], 0, 0, 0, 0, 0, 0, w, L, 1);
  });
  // 后颈蓑羽：盖住头颈接缝
  const hackleGeo = own(featherGeo([
    { y: 0, wl: 0.3, wr: 0.3, t: 0.08, c: C.cap },
    { y: -0.5, wl: 0.45, wr: 0.45, t: 0.08, c: C.cap },
    { y: -0.85, wl: 0.25, wr: 0.25, t: 0.05, c: C.slateDark },
    { y: -1, wl: 0, wr: 0, t: 0, c: C.slateDark },
  ]));
  for (let i = -2; i <= 2; i++) {
    const g = grp(head, i * 0.034, 0.07, -0.118 + Math.abs(i) * 0.012, 0.42, i * 0.42, -i * 0.12);
    mesh(g, hackleGeo, mVC, 0, 0, 0, 0, 0, 0, 0.075, 0.12 - Math.abs(i) * 0.012, 0.12);
  }

  // ───────────── 翅膀 ─────────────
  // 羽色：石板蓝灰（不是鹦鹉蓝），越往翼尖越深；覆羽 / 次级飞羽带浅色羽缘，成排的羽缘读出「层层叠压的羽片」
  const primLv: FeatherLevel[] = [
    { y: 0, wl: 0.18, wr: 0.12, t: 0.05, c: 0x56647a },
    { y: -0.12, wl: 0.42, wr: 0.26, t: 0.06, c: 0x4b586d },
    { y: -0.42, wl: 0.5, wr: 0.28, t: 0.055, c: 0x3e495b },
    { y: -0.66, wl: 0.46, wr: 0.25, t: 0.05, c: 0x2f3746 },
    { y: -0.84, wl: 0.34, wr: 0.18, t: 0.04, c: 0x222833 },
    { y: -0.95, wl: 0.16, wr: 0.08, t: 0.025, c: 0x1c2029 },
    { y: -1, wl: 0, wr: 0, t: 0, c: 0x1c2029 },
  ];
  const secLv: FeatherLevel[] = [
    { y: 0, wl: 0.25, wr: 0.25, t: 0.05, c: 0x5a687e },
    { y: -0.15, wl: 0.46, wr: 0.42, t: 0.06, c: 0x505e74 },
    { y: -0.46, wl: 0.48, wr: 0.44, t: 0.056, c: 0x465267 },
    { y: -0.6, wl: 0.48, wr: 0.44, t: 0.052, c: 0x56637a },
    { y: -0.66, wl: 0.47, wr: 0.44, t: 0.05, c: 0x3b4658 },
    { y: -0.84, wl: 0.42, wr: 0.38, t: 0.04, c: 0x272e3a },
    { y: -0.94, wl: 0.28, wr: 0.25, t: 0.03, c: 0x74829a },
    { y: -1, wl: 0.06, wr: 0.05, t: 0.01, c: 0x74829a },
  ];
  const covLv: FeatherLevel[] = [
    { y: 0, wl: 0.32, wr: 0.32, t: 0.07, c: 0x647390 },
    { y: -0.25, wl: 0.5, wr: 0.5, t: 0.08, c: 0x5a6982 },
    { y: -0.55, wl: 0.48, wr: 0.48, t: 0.07, c: 0x4c5970 },
    { y: -0.76, wl: 0.36, wr: 0.36, t: 0.055, c: 0x8592a8 },
    { y: -0.9, wl: 0.18, wr: 0.18, t: 0.03, c: 0x8592a8 },
    { y: -1, wl: 0, wr: 0, t: 0, c: 0x8592a8 },
  ];
  const UNDER = 0xc8ced9;
  const primGeo = own(featherGeo(primLv, UNDER));
  const secGeo = own(featherGeo(secLv, UNDER));
  const covGeo = own(featherGeo(covLv, UNDER));
  const primStrip = own(edgeStripGeo(primLv, 2, 0.09, 1));
  const secStrip = own(edgeStripGeo(secLv, 1, 0.08, -1));
  const CARPAL: [number, number, number] = [0.3, 0.33, -0.02];
  /** 翼前缘在比例 f 处的位置（翼根 → 腕的微拱） */
  const boneAt = (f: number): [number, number] => {
    const x = CARPAL[0] * f;
    const y = CARPAL[1] * f + 0.05 * Math.sin(Math.PI * f);
    return [x, y];
  };
  // 翼前缘（沿 boneAt 放样、较厚）：一条顺滑的拱形上缘，把小覆羽的根部包在里面，不露出台阶状的羽根
  const boneGeo = own(loftGeo([0, 0.2, 0.4, 0.6, 0.8, 1, 1.1].map((f): Sec => {
    const [x, y] = boneAt(Math.min(1, f));
    const e = f > 1 ? 0.02 : 0;
    const w = f > 1 ? 0.03 : 0.085 - 0.03 * f;
    return [x + e, y + e * 0.4, -0.02 * Math.min(1, f) - 0.01, w, w * 0.9];
  }), { sides: 6, hint: [0, 0, 1] }));

  const buildWing = (parent: THREE.Group): WingRig => {
    const wing = grp(parent, 0.082, 0.13, -0.118);
    const arm = grp(wing);
    mesh(arm, boneGeo, mWingBone);
    const handG = grp(arm, CARPAL[0], CARPAL[1], CARPAL[2]);
    const feathers: FeatherJ[] = [];
    let stripIdx = 0;
    const add = (
      host: THREE.Group, geo: THREE.BufferGeometry, strip: THREE.BufferGeometry | null,
      x: number, y: number, z: number, L: number, W: number, fold: number, open: number, delay: number, amp: number,
    ): void => {
      const g = grp(host, x, y, z, 0, 0, fold);
      mesh(g, geo, mVC, 0, 0, 0, 0, 0, 0, W, L, 0.14);
      if (strip) mesh(g, strip, mStrips[stripIdx++ % 3], 0, 0, 0, 0, 0, 0, W, L, 1);
      feathers.push({ g, fold, open, delay, ph: feathers.length * 0.55, amp });
    };
    // 初级飞羽（挂在腕上，最贴身、最长，翼尖越过小腿）
    const NP = 7;
    for (let i = 0; i < NP; i++) {
      const f = i / (NP - 1);
      const px = -0.1 * f;
      const py = -0.02 - 0.13 * f;
      const L = 1.38 - 0.04 * i;
      const tipX = 0.03 + 0.012 * i;
      const fold = Math.asin(THREE.MathUtils.clamp((tipX - (CARPAL[0] + px)) / L, -1, 1));
      add(handG, primGeo, primStrip, px, py, 0.034 - 0.006 * i, L, 0.115, fold, 0.54 - 0.03 * i, 0.03 + (NP - 1 - i) * 0.018, 0.5 + f * 0.5);
    }
    // 次级飞羽（挂在翼臂上，中层；内缘带雷光）。羽尖向初级飞羽的羽尖线收拢 → 收拢的翅膀上宽下窄
    const NS = 7;
    for (let j = 0; j < NS; j++) {
      const f = 0.12 + j * 0.13;
      const [x, y] = boneAt(f);
      const L = 0.72 + 0.04 * j + 0.06 * f;
      const fold = Math.asin(THREE.MathUtils.clamp((0.1 + 0.08 * f - x) / L, -1, 1));
      add(arm, secGeo, secStrip, x, y - 0.025, -0.004 - 0.003 * j, L, 0.14, fold, 0.24 + 0.035 * j, 0.02 + j * 0.011, 0.8);
    }
    // 大覆羽（外层）：一排向内收的圆尖羽，浅色羽缘连成扇贝边
    const NG = 8;
    for (let k = 0; k < NG; k++) {
      const f = 0.05 + k * 0.13;
      const [x, y] = boneAt(f);
      const L = 0.34 + 0.012 * k;
      const fold = Math.asin(THREE.MathUtils.clamp((0.03 - 0.3 * x) / L, -1, 1));
      add(arm, covGeo, null, x, y - 0.012, -0.03 - 0.002 * k, L, 0.13, fold, 0.3 + 0.03 * k, k * 0.01, 1);
    }
    // 小覆羽（翼前缘，盖住翼骨）
    const NL = 8;
    for (let k = 0; k < NL; k++) {
      const f = 0.03 + k * 0.135;
      const [x, y] = boneAt(f);
      add(arm, covGeo, null, x, y + 0.008, -0.046, 0.18, 0.11, 0.06 - 0.02 * k, 0.28, 0, 1);
    }
    // 小翼羽（沿外缘向下）
    add(handG, covGeo, null, 0.012, 0.02, -0.04, 0.2, 0.075, 0.35, 0.9, 0.05, 1.2);
    // 肩羽（翼根内侧，盖住与风衣的接缝）
    for (let k = 0; k < 3; k++) {
      add(wing, covGeo, null, 0.02 + k * 0.035, 0.03 + k * 0.03, -0.03, 0.42 - k * 0.05, 0.12, -0.16 + k * 0.05, -0.05 + k * 0.05, 0, 0.6);
    }
    return { wing, arm, hand: handG, feathers };
  };
  const wingL = buildWing(chest);
  const wingMirror = grp(chest);
  wingMirror.scale.x = -1;
  const wingR = buildWing(wingMirror);
  const wings = [wingL, wingR];

  // ───────────── 基础姿势 ─────────────
  const restQ = new THREE.Quaternion();

  // ───────────── 动画状态 ─────────────
  let introT = -1;
  let carry = 0;
  let carryAim = 0;
  let crestX = 0;
  let crestV = 0;
  let crestZ = 0;
  let crestVZ = 0;
  let prevYaw = 0;
  let prevPitch = 0;
  let first = true;

  /** 翅膀展开曲线：展开部分用 uo、收拢部分用 uc（各自带逐羽延迟） */
  const openCurve = (uo: number, uc: number): number => {
    const o = uo < 0.08 ? 0 : easeOutBack((uo - 0.08) / 0.26, 1.3);
    const c = uc < 0.7 ? 1 : 1 - easeInOut((uc - 0.7) / 0.5);
    return o * c;
  };
  const aimCurve = (u: number): number => {
    const o = smooth((u - 0.08) / 0.28);
    const c = u < 0.66 ? 1 : 1 - easeInOut((u - 0.66) / 0.46);
    return o * c;
  };

  const update = (dt: number, t: number): void => {
    // ── 亮相时间轴
    let u = INTRO_LEN;
    if (introT >= 0) {
      introT += dt;
      if (introT >= INTRO_LEN) introT = -1;
      else u = introT;
    }
    const active = introT >= 0;
    const fade = active ? 1 - smooth(u / 0.22) : 0;
    const wOpen = Math.max(active ? openCurve(u, u) : 0, carry * fade);
    const wAim = Math.max(active ? aimCurve(u) : 0, carryAim * fade);
    // 起势下蹲（0–0.24 秒蓄力后弹起）+ 收翼时的轻微落定；sin² 保证起止都是零速度
    const crouch = active ? bump(u / 0.24) + 0.4 * bump((u - 0.95) / 0.42) : 0;
    const tuck = active ? Math.sin(Math.PI * clamp01(u / 0.12)) : 0;
    const flash = active ? Math.exp(-(((u - 0.3) / 0.09) ** 2)) : 0;

    // ── 呼吸与重心
    const br = Math.sin((t * TAU) / 3.6);
    const brLag = Math.sin((t * TAU) / 3.6 - 0.7);
    const sway = Math.sin((t * TAU) / 7.3);

    // 屈膝角 dip 与髋部下沉量按两段腿几何一致换算，脚掌保持贴地
    const dip = 0.27 * crouch;
    const drop = (THIGH + SHIN) * (1 - Math.cos(dip));
    hips.position.set(0.006 * sway, HIP_Y - drop + 0.003 * br, 0);
    hips.rotation.set(0.02 * crouch, -0.05 + 0.06 * wAim, 0.035 + 0.008 * sway);
    spine.rotation.set(0.04 * crouch - 0.01 * br, 0.05 * wAim, -0.012);
    chest.position.y = 0.16 + 0.004 * br;
    chest.rotation.set(-0.035 - 0.015 * br + 0.06 * crouch - 0.05 * wOpen, 0.06 + 0.12 * wAim, -0.03 - 0.006 * sway);

    // ── 腿（左腿承重；右腿前伸外撇）
    legL.hip.rotation.set(-0.02 - dip, 0.06, -0.045 - 0.008 * sway);
    legL.knee.rotation.set(0.04 + dip * 2, 0, 0);
    legL.ankle.rotation.set(-0.02 - dip, 0.05, 0.045);
    legR.hip.rotation.set(-0.15 - dip, -0.18, -0.115 - 0.008 * sway);
    legR.knee.rotation.set(0.21 + dip * 2, 0, 0);
    legR.ankle.rotation.set(-0.06 - dip, -0.1, 0.1);

    // 下摆随髋轻摆（滞后）
    skirtL.rotation.set(0.02 * brLag - 0.05 * crouch, 0, -0.03 + 0.01 * Math.sin((t * TAU) / 7.3 - 0.8));
    skirtRm.rotation.set(-0.06 + 0.02 * brLag - 0.05 * crouch, 0, 0.03 - 0.01 * Math.sin((t * TAU) / 7.3 - 0.8));
    sashA.rotation.z = 0.05 + 0.04 * Math.sin(t * 1.3 - 0.4) + 0.15 * wOpen;
    sashB.rotation.z = 0.2 + 0.05 * Math.sin(t * 1.3 - 1.0) + 0.2 * wOpen;

    // ── 手臂：低位警戒 ↔ 抬枪瞄准
    solveRightArm(wAim, br);
    armL.shoulder.quaternion.copy(lIdle.shoulder);
    _q.setFromEuler(_e.set(0, 0, 0.015 * br + 0.05 * wOpen));
    armL.shoulder.quaternion.multiply(_q);
    armL.elbow.rotation.set(lIdle.elbow - 0.01 * br, 0, 0);
    armL.wrist.quaternion.copy(lIdle.wrist);
    // 肩甲部分跟随上臂
    pauldrons[0].quaternion.slerpQuaternions(restQ, armL.shoulder.quaternion, 0.3);
    pauldrons[1].quaternion.slerpQuaternions(restQ, armR.shoulder.quaternion, 0.3);

    // ── 头：离散顿挫转头（头 0.1 秒内到位，脖子慢半拍跟上）
    const hk = headKey(t, 0.13, _hk);
    const nk = headKey(t, 0.45, _hk2);
    // 瞄准时视线沿枪管（头的世界朝向 ≈ 枪口方位）
    const aimYaw = 0.08;
    const yaw = hk.x * (1 - wAim) + aimYaw * wAim;
    const pitch = hk.y * (1 - wAim) + 0.06 * wAim + 0.05 * crouch;
    const roll = hk.z * (1 - wAim) - 0.08 * wAim;
    const nYaw = nk.x * (1 - wAim) + aimYaw * wAim;
    neck.rotation.set(0.04 - 0.012 * brLag + 0.3 * nk.y * (1 - wAim), 0.35 * nYaw, 0.03);
    head.rotation.set(pitch - 0.3 * nk.y * (1 - wAim) - 0.04, yaw - 0.35 * nYaw - 0.06 - 0.12 * wAim, roll + 0.012);
    // 冠羽惯性：由头部角速度驱动的弹簧
    const sdt = Math.max(1e-3, dt);
    const yawVel = first ? 0 : (yaw - prevYaw) / sdt;
    const pitchVel = first ? 0 : (pitch - prevPitch) / sdt;
    prevYaw = yaw;
    prevPitch = pitch;
    first = false;
    crestV += (-200 * crestX - 14 * crestV - 0.5 * pitchVel) * dt;
    crestX += crestV * dt;
    crestVZ += (-200 * crestZ - 14 * crestVZ + 0.4 * yawVel) * dt;
    crestZ += crestVZ * dt;
    crest.rotation.set(crestX + 0.04 * Math.sin(t * 2.1) - 0.15 * wOpen, 0, crestZ);

    // ── 翅膀
    for (let w = 0; w < 2; w++) {
      const wr = wings[w];
      const breathe = 0.018 * brLag;
      wr.wing.rotation.set(0.14 + breathe - 0.12 * wOpen + 0.03 * tuck, -0.27 - 0.06 * tuck - 0.06 * wOpen, 0.09 * wOpen - 0.02 * tuck);
      wr.arm.rotation.set(0, 0, 0.08 * wOpen + 0.03 * tuck + 0.012 * br);
      wr.hand.rotation.set(0, 0, 0.02 * wOpen);
      const ripAmp = 0.5 + 0.5 * Math.sin(t * 0.43 + w);
      for (let i = 0; i < wr.feathers.length; i++) {
        const f = wr.feathers[i];
        const pi = active ? Math.max(openCurve(u - f.delay, u - (0.14 - f.delay)), carry * fade) : 0;
        const rz = f.fold + (f.open - f.fold) * pi;
        const rip = 0.022 * f.amp * Math.sin(t * 1.9 - f.ph + w * 0.8) * ripAmp;
        f.g.rotation.set(rip + 0.03 * pi, 0, rz + rip * 0.4);
      }
    }

    // ── 发光：雷光条闪烁 + 亮相增强
    const boost = 1 + 1.1 * Math.min(1, wOpen) + 1.6 * flash;
    for (let k = 0; k < 3; k++) {
      const spike = Math.max(0, Math.sin(t * 13.7 + k * 1.9) * Math.sin(t * 4.3 + k * 0.7) - 0.78) * 5;
      const fl = 0.72 + 0.14 * Math.sin(t * 2.3 + k * 2.1) + spike;
      mStrips[k].color.copy(glowBase).multiplyScalar(fl * boost);
    }
    mEye.color.copy(glowBase).multiplyScalar(1 + 0.08 * Math.sin(t * 3.1) + 0.6 * wAim + flash);
    _col.copy(glowBase).multiplyScalar(0.85 + 0.15 * Math.sin(t * 1.7) + 0.9 * wOpen);
    mAccent.color.copy(_col);
  };

  return {
    root,
    height: 1.85,
    hand,
    materials: K.mats.slice(),
    update,
    playIntro(): void {
      if (introT >= 0) {
        // 播放中再次触发：从当前姿态平滑接回开头
        const u = introT;
        const f = 1 - smooth(u / 0.22);
        carry = Math.max(openCurve(u, u), carry * f);
        carryAim = Math.max(aimCurve(u), carryAim * f);
      } else {
        carry = 0;
        carryAim = 0;
      }
      introT = 0;
    },
    dispose(): void {
      K.dispose();
    },
  };
}
