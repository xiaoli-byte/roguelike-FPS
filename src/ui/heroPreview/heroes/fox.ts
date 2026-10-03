/**
 * 赤狐 · 焰尾游侠 —— 英雄选择舞台的展示模型。
 *
 * 兽首人身的狐族女游侠：赤橙皮毛、白色口吻 / 胸毛 / 尾尖、黑色耳尖与「黑袜子」手脚、
 * 琥珀色发光眼与额前火纹。轻装皮甲 + 朱红围巾 + 腰间燃爆雷。
 * 剪影主角是身后三条叠瓦毛簇的蓬松大尾巴：两条自髋侧扫出后高高扬起、一条低低地扫向左侧再上勾，
 * 正面与选人舞台的右前 3/4 机位下左右都能看到；尾尖白毛上燃着焰芯 + 加性火舌 + 柔光 + 火星的狐火（大体朝上）。
 * 右手低持冲锋枪，左手掌心托着一团狐火。
 *
 * 骨架：hips → spine → chest → neck → head；chest → 肩 → 肘 → 腕（两段 IK 贴合枪 / 掌心目标）；
 * hips → 髋 → 膝 → 踝；hips → 尾根 → 3 条 7 节蒙皮尾链；chest → 枪挂点（= rig.hand）。
 */
import * as THREE from 'three';
import { Geo } from '../../../enemies/Models';
import type { HeroRig } from './types';
import { buildFoxTail } from './foxTail';
import { FoxKit, Spring, bevelBox, clamp01, makeRng, mirrorX, ring, solveArm, sym } from './foxKit';

// ───────────────────────────── 配色 ─────────────────────────────

const C = {
  fur: 0xd95a1e,
  furDeep: 0xa33c15,
  furLight: 0xeb8a45,
  white: 0xf1e7d8,
  black: 0x221a1c,
  nose: 0x100b0c,
  leather: 0x6e3f27,
  leatherDark: 0x3b2419,
  ink: 0x3b3340,
  vermilion: 0xc0261c,
  gold: 0xd9a84a,
  wrap: 0xa8977a,
  iron: 0x3b3634,
  glow: 0xff6a1f,
  glowMid: 0xffa040,
  glowCore: 0xfff0c4,
  eye: 0xffb43c,
} as const;

// ───────────────────────────── 尺寸 ─────────────────────────────

const HIP_Y = 0.912;
const THIGH = 0.42;
const SHIN = 0.395;
const UPPER = 0.28;
const SHOULDER_X = 0.172;
const FORE = 0.25;
const HEAD_SCALE = 1.24;
const EYE_S = 1.3;

/** 右腕关节在枪本地空间中的位置（握把后下方） */
const WRIST_IN_GUN = new THREE.Vector3(-0.012, -0.075, 0.095);

const TAIL_LEN = [0.12, 0.14, 0.15, 0.15, 0.15, 0.14, 0.12];
/** 每节起点半径（最后一个为尾尖半径） */
const TAIL_R = [0.05, 0.088, 0.122, 0.142, 0.15, 0.142, 0.112, 0.052];
/**
 * 尾巴静止姿态：yaw = 扫出方向（0 = 正后方，+ = 向角色右侧 −X），lift = 第一节相对水平的仰角（负 = 先向下垂），
 * roll = 绕第一节方向的侧倾（让上扬段向外 / 向内倒），curl = 各节在扫出平面内向上弯的角度，
 * side = 各节出平面的侧弯（S 形），phase = 摆动相位，scale = 整体缩放；
 * open / rise = 亮相扇形展开时 yaw / lift 的增量（按展开量 fo 缩放）。
 */
interface TailSpec { yaw: number; lift: number; roll: number; curl: number[]; side: number[]; phase: number; scale: number; open: number; rise: number }
const TAIL_S = [0, 0.08, 0.05, -0.05, -0.1, -0.05, 0.05, 0.1];
const TAILS: TailSpec[] = [
  // 右（持枪侧）：自髋侧向外下方扫出，再高高扬起，尾尖内勾
  { yaw: 0.95, lift: -0.25, roll: 0, curl: [0, 0.5, 0.45, 0.25, 0.05, 0.0, 0.15, 0.25], side: TAIL_S, phase: 0, scale: 1.08, open: 1.1, rise: 0.1 },
  // 中：短一些，低低地扫向左侧再上勾（让 3/4 视角下左右都有尾巴）
  { yaw: -1.6, lift: -0.6, roll: 0, curl: [0, 0.2, 0.28, 0.3, 0.28, 0.22, 0.14, 0.1], side: TAIL_S.map(() => 0), phase: 2.2, scale: 0.84, open: 2.2, rise: 1.3 },
  // 左：向外扫出后上扬
  { yaw: -1.05, lift: -0.2, roll: 0, curl: [0, 0.5, 0.45, 0.28, 0.1, 0.0, 0.12, 0.22], side: TAIL_S.map((v) => -v), phase: 4.1, scale: 1.04, open: -1.1, rise: 0.1 },
];

// ───────────────────────────── 临时变量 ─────────────────────────────

const _v = new THREE.Vector3();
const _p = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _c = new THREE.Color();
const _e = new THREE.Euler();

function quatYXZ(pitch: number, yaw: number, roll: number): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, 'YXZ'));
}

/** 枪的朝向：本地 −Z（枪口）指向 muzzle，本地 +Y（枪背）尽量指向 top */
function aimBasis(muzzle: THREE.Vector3, top: THREE.Vector3): THREE.Quaternion {
  const z = muzzle.clone().normalize().negate();
  const y = top.clone().addScaledVector(z, -top.dot(z)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** 手的朝向：本地 −Y 指向 fingers，本地 +Z 指向 palm */
function handBasis(fingers: THREE.Vector3, palm: THREE.Vector3): THREE.Quaternion {
  const y = fingers.clone().normalize().negate();
  const z = palm.clone().addScaledVector(y, -palm.dot(y)).normalize();
  const x = new THREE.Vector3().crossVectors(y, z);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

/** 周期性的短促脉冲（0→1→0），用于眨眼、耳朵抖动 */
function pulse(t: number, period: number, offset: number, width: number): number {
  const p = (((t + offset) % period) + period) % period;
  return p < width ? Math.sin((p / width) * Math.PI) : 0;
}

export function buildFoxModel(): HeroRig {
  const kit = new FoxKit();
  const rand = makeRng(0x5f0c);
  const M = {
    fur: kit.std(C.fur, 0.85),
    furDeep: kit.std(C.furDeep, 0.88),
    white: kit.std(C.white, 0.9),
    black: kit.std(C.black, 0.85),
    nose: kit.std(C.nose, 0.4, 0.1),
    leather: kit.std(C.leather, 0.7, 0.05),
    leatherDark: kit.std(C.leatherDark, 0.75, 0.05),
    ink: kit.std(C.ink, 0.85),
    vermilion: kit.std(C.vermilion, 0.6, 0.05),
    gold: kit.std(C.gold, 0.35, 0.75),
    wrap: kit.std(C.wrap, 0.9),
    iron: kit.std(C.iron, 0.5, 0.5),
    glow: kit.glow(C.glow),
    glowMid: kit.glow(C.glowMid),
    glowCore: kit.glow(C.glowCore),
    eye: kit.glow(C.eye),
    flame: kit.flameMat(true, 0.95),
    flameCore: kit.flameMat(false),
    halo: kit.spriteGlow(C.glow, 0.5),
  };

  const root = new THREE.Group();
  root.name = 'hero:fox';

  // ── 火焰：不透明的亮黄焰芯 + 加性的赤橙主焰与一圈外翻小火舌 + 淡淡的光晕 + 上飘的火星（沿本地 +Y），s = 主焰半径 ──
  const cCore0 = new THREE.Color(0xfffbe8);
  const cCore1 = new THREE.Color(0xffc24a);
  const cOut0 = new THREE.Color(0xffc054);
  const cOut1 = new THREE.Color(0xff3a0c);
  interface Flame { root: THREE.Group; parts: THREE.Object3D[]; ph: number[]; rz: number[]; halo: THREE.Object3D; embers: THREE.Object3D[]; s: number }
  const makeFlame = (parent: THREE.Object3D, s: number, x = 0, y = 0, z = 0, tongues = 4, embersN = 2): Flame => {
    const g = kit.joint(parent, x, y, z);
    const parts: THREE.Object3D[] = [];
    const ph: number[] = [];
    const rz: number[] = [];
    const add = (o: THREE.Object3D, lean: number): void => {
      parts.push(o);
      ph.push(rand() * Math.PI * 2);
      rz.push(lean);
    };
    // 0：主焰（加性，略向一侧勾）
    add(kit.mesh(g, kit.flameGeo(s * 3.9, s, 0.1, cOut0, cOut1, 6, rand() * 3), M.flame, 0, -s * 0.15, 0, 0, rand() * 3, 0), 0);
    // 1：焰芯（不透明，亮白→金）
    add(kit.mesh(g, kit.flameGeo(s * 2.1, s * 0.62, 0.06, cCore0, cCore1, 5, rand() * 3), M.flameCore, 0, -s * 0.12, 0), 0);
    // 2..：外翻的小火舌
    for (let i = 0; i < tongues; i++) {
      const a = (i / tongues) * Math.PI * 2 + rand() * 0.7;
      const arm = kit.joint(g, 0, 0, 0, 0, a, 0);
      const h = s * (1.7 + rand() * 1.1);
      kit.mesh(arm, kit.flameGeo(h, s * 0.5, 0.38, cOut0, cOut1, 5, rand() * 3), M.flame, s * 0.38, -s * 0.05, 0);
      add(arm, 0.1 + rand() * 0.16);
    }
    const halo = new THREE.Sprite(M.halo);
    halo.position.set(0, s * 1.3, 0);
    g.add(halo);
    const embers: THREE.Object3D[] = [];
    for (let i = 0; i < embersN; i++) {
      const e = kit.joint(g, 0, 0, 0, 0, rand() * Math.PI * 2, 0);
      kit.mesh(e, Geo.octa(s * 0.16), M.glowMid, 0, 0, 0, 0, 0, 0, 1, 1.6, 1);
      embers.push(e);
      ph.push(rand());
    }
    return { root: g, parts, ph, rz, halo, embers, s };
  };
  const flicker = (f: Flame, t: number, k: number): void => {
    const p = f.parts;
    for (let i = 0; i < p.length; i++) {
      const w = Math.sin(t * (9 + i * 1.7) + f.ph[i] + k);
      const w2 = Math.sin(t * (14.3 + i * 0.9) + f.ph[i] * 1.7);
      if (i < 2) {
        p[i].scale.set(1 - 0.07 * w, 1 + 0.16 * w + 0.07 * w2, 1 - 0.07 * w);
        p[i].rotation.z = 0.08 * w2;
      } else {
        p[i].scale.set(1, 1 + 0.3 * w, 1);
        p[i].rotation.z = -(f.rz[i] + 0.14 * w2);
      }
    }
    const hp = f.s * (1 + 0.08 * Math.sin(t * 7.3 + k));
    f.halo.scale.set(6.5 * hp, 7.5 * hp, 1);
    // 火星：自焰心上飘、渐小，循环
    const n0 = p.length;
    for (let i = 0; i < f.embers.length; i++) {
      const u = (t * 0.9 + f.ph[n0 + i] + k * 0.13) % 1;
      const e = f.embers[i];
      const r = f.s * (0.5 + 0.9 * u);
      e.position.set(Math.sin(u * 9 + i) * r * 0.6, f.s * (1.2 + 4.2 * u), Math.cos(u * 7 + i * 2) * r * 0.6);
      e.scale.setScalar(Math.max(0.001, 1 - u));
    }
  };
  /** 让火焰大体朝世界上方（amount = 1 完全竖直），挂在骨骼上的火焰也不会随尾尖横躺 */
  const uprightFlame = (f: Flame, amount: number): void => {
    const par = f.root.parent;
    if (!par) return;
    par.getWorldQuaternion(_q);
    root.getWorldQuaternion(_q2);
    _q.invert().multiply(_q2);
    f.root.quaternion.identity().slerp(_q, amount);
  };

  // ═════════════════════════════ 骨盆 / 腿 ═════════════════════════════
  const hips = kit.joint(root, 0, HIP_Y, 0);
  {
    const p: number[] = [];
    ring(p, 0.09, 0.112, 0.082, 8);
    ring(p, 0.0, 0.148, 0.098, 8, 0, -0.005);
    ring(p, -0.07, 0.132, 0.09, 8);
    ring(p, -0.125, 0.07, 0.065, 6);
    p.push(0.07, -0.04, -0.118, -0.07, -0.04, -0.118);
    kit.mesh(hips, kit.hull(p), M.ink);
  }
  // 朱红腰封 + 斜挎皮腰带
  {
    const p: number[] = [];
    ring(p, 0.135, 0.116, 0.086, 10);
    ring(p, 0.06, 0.128, 0.094, 10);
    kit.mesh(hips, kit.hull(p), M.vermilion);
    const b: number[] = [];
    ring(b, 0.045, 0.142, 0.104, 10);
    ring(b, 0.005, 0.148, 0.106, 10);
    kit.mesh(hips, kit.hull(b), M.leatherDark, 0, 0.01, 0, 0.04, 0, -0.09);
    kit.mesh(hips, kit.hull(bevelBox(-0.032, 0.032, -0.025, 0.025, -0.008, 0.008, 0.007)), M.gold, -0.012, 0.03, 0.108, 0.04, 0, -0.09);
    kit.mesh(hips, kit.hull(bevelBox(-0.018, 0.018, -0.013, 0.013, -0.004, 0.012, 0.004)), M.leatherDark, -0.012, 0.03, 0.112, 0.04, 0, -0.09);
  }
  // 燃爆雷（挂在皮腰带上）
  const grenade = (x: number, y: number, z: number, ry: number): void => {
    const g = kit.joint(hips, x, y, z, 0, ry, 0);
    kit.mesh(g, Geo.ico(0.034, 0), M.iron, 0, -0.04, 0, 0, 0, 0, 1, 1.15, 1);
    kit.mesh(g, Geo.cyl(0.036, 0.036, 0.013, 8), M.glow, 0, -0.04, 0);
    kit.mesh(g, Geo.cyl(0.012, 0.016, 0.022, 6), M.gold, 0, -0.002, 0);
    kit.mesh(g, Geo.torus(0.011, 0.0035, 4, 8), M.gold, 0.013, 0.004, 0, 0, Math.PI / 2, 0);
  };
  grenade(-0.135, 0.0, 0.07, 0.6);
  grenade(-0.156, -0.012, -0.015, 1.4);
  grenade(0.128, 0.036, 0.075, -0.6);
  // 前垂布（朱红 + 墨边 + 金饰）与侧甲片
  {
    const front = sym([0.07, 0.05, 0.112, 0.07, 0.05, 0.098, 0.056, -0.235, 0.146, 0.056, -0.235, 0.132, 0.0, -0.265, 0.146]);
    kit.mesh(hips, kit.hull(front), M.vermilion);
    const edge = sym([0.08, 0.055, 0.106, 0.064, -0.25, 0.138, 0.0, -0.283, 0.138, 0.08, 0.055, 0.094, 0.064, -0.25, 0.124]);
    kit.mesh(hips, kit.hull(edge), M.ink);
    kit.mesh(hips, Geo.cyl(0.026, 0.026, 0.008, 8), M.gold, 0, -0.09, 0.136, Math.PI / 2 + 0.12, 0, 0);
    kit.mesh(hips, Geo.octa(0.012), M.glow, 0, -0.09, 0.142, 0, 0, 0, 1, 1.3, 0.5);
    const side = [0.138, 0.06, 0.07, 0.138, 0.06, -0.08, 0.152, 0.06, 0.0, 0.186, -0.15, 0.065, 0.186, -0.15, -0.075, 0.2, -0.15, -0.005,
      0.172, -0.15, 0.06, 0.172, -0.15, -0.07];
    for (const s of [1, -1]) {
      const pts = s > 0 ? side : mirrorX(side);
      kit.mesh(hips, kit.hull(pts), M.leather);
      const trim = [0.18, -0.13, 0.068, 0.18, -0.13, -0.078, 0.188, -0.158, 0.068, 0.188, -0.158, -0.078, 0.2, -0.158, -0.005, 0.192, -0.13, -0.005];
      kit.mesh(hips, kit.hull(s > 0 ? trim : mirrorX(trim)), M.gold, s * 0.004, 0, 0);
    }
  }
  // 尾根毛团
  kit.mesh(hips, kit.fluff(rand, 0, -0.02, -0.1, 0.075, 0.07, 0.06, 14, 0.12, 5, 0.3, 0), M.fur);

  interface Leg { hip: THREE.Group; knee: THREE.Group; ankle: THREE.Group }
  const buildLeg = (side: number): Leg => {
    const hip = kit.joint(hips, side * 0.088, -0.03, 0);
    kit.mesh(hip, kit.limb([
      { y: 0, rx: 0.086, rz: 0.09 },
      { y: 0.13, rx: 0.087, rz: 0.091, cz: 0.008 },
      { y: THIGH, rx: 0.05, rz: 0.055 },
    ], 7), M.ink);
    // 大腿外侧皮护 / 右腿弹药袋
    if (side < 0) {
      const pouch = kit.joint(hip, -0.07, -0.16, 0.01, 0, 0, 0.06);
      kit.mesh(pouch, kit.hull(bevelBox(-0.03, 0.012, -0.05, 0.05, -0.05, 0.05, 0.01)), M.leather);
      kit.mesh(pouch, kit.hull(bevelBox(-0.034, 0.0, 0.03, 0.055, -0.052, 0.052, 0.008)), M.leatherDark);
      kit.mesh(pouch, Geo.box(0.006, 0.012, 0.03), M.gold, -0.034, 0.03, 0);
      kit.mesh(hip, kit.limb([{ y: 0.12, rx: 0.088, rz: 0.093, cz: 0.006 }, { y: 0.15, rx: 0.088, rz: 0.093, cz: 0.006 }], 8), M.leatherDark);
    }
    const knee = kit.joint(hip, 0, -THIGH, 0);
    kit.mesh(knee, kit.limb([{ y: -0.025, rx: 0.057, rz: 0.061 }, { y: 0.04, rx: 0.056, rz: 0.06 }], 7), M.ink);
    kit.mesh(knee, kit.hull(sym([0.04, 0.045, 0.035, 0.046, -0.04, 0.045, 0.028, 0.035, 0.066, 0.03, -0.055, 0.07, 0.0, 0.0, 0.085, 0.0, 0.05, 0.06, 0.0, -0.07, 0.072])), M.leather);
    kit.mesh(knee, kit.limb([
      { y: 0, rx: 0.05, rz: 0.054 },
      { y: 0.11, rx: 0.056, rz: 0.062, cz: -0.012 },
      { y: SHIN - 0.05, rx: 0.032, rz: 0.036 },
      { y: SHIN, rx: 0.03, rz: 0.034 },
    ], 7), M.black);
    // 绑腿（交错倾斜的布条）
    const shinR = (y: number): number => (y < 0.11 ? 0.05 + (0.006 * y) / 0.11 : 0.056 - ((y - 0.11) / (SHIN - 0.16)) * 0.024);
    for (let i = 0; i < 4; i++) {
      const y = 0.12 + i * 0.05;
      const r = shinR(y) + 0.004;
      const g = kit.limb([{ y: -0.015, rx: r + 0.002, rz: r + 0.007, cz: -0.004 }, { y: 0.015, rx: r, rz: r + 0.005, cz: -0.004 }], 7);
      kit.mesh(knee, g, M.wrap, 0, -y, 0, (i % 2 ? 0.16 : -0.14), 0, (i % 2 ? -0.12 : 0.14));
    }
    const ankle = kit.joint(knee, 0, -SHIN, 0);
    kit.mesh(ankle, kit.hull(sym([
      0.035, -0.048, -0.045, 0.03, 0.0, -0.04, 0.033, 0.01, 0.025, 0.043, -0.035, 0.12, 0.046, -0.048, 0.13,
      0.0, -0.04, 0.168, 0.0, -0.048, 0.162, 0.0, 0.012, -0.03,
    ])), M.black);
    kit.mesh(ankle, kit.hull(sym([0.042, -0.048, -0.055, 0.05, -0.048, 0.15, 0.0, -0.048, 0.178, 0.042, -0.06, -0.055, 0.05, -0.06, 0.15, 0.0, -0.06, 0.178])), M.leatherDark);
    kit.mesh(ankle, kit.hull(sym([0.05, -0.05, 0.05, 0.05, -0.05, 0.075, 0.043, -0.022, 0.05, 0.043, -0.022, 0.078, 0.0, -0.01, 0.05, 0.0, -0.012, 0.078])), M.vermilion);
    kit.mesh(ankle, kit.limb([{ y: -0.005, rx: 0.036, rz: 0.04 }, { y: 0.025, rx: 0.038, rz: 0.042 }], 7), M.vermilion);
    for (let i = -1; i <= 1; i++) kit.mesh(ankle, Geo.cone(0.008, 0.022, 4), M.white, i * 0.024, -0.042, 0.166 - Math.abs(i) * 0.012, Math.PI / 2, 0, 0);
    return { hip, knee, ankle };
  };
  const legL = buildLeg(1);
  const legR = buildLeg(-1);

  // ═════════════════════════════ 躯干 ═════════════════════════════
  const spine = kit.joint(hips, 0, 0.1, 0);
  {
    const p: number[] = [];
    ring(p, -0.03, 0.112, 0.082, 8);
    ring(p, 0.16, 0.118, 0.086, 8);
    kit.mesh(spine, kit.hull(p), M.leather);
    // 腹部甲片横纹
    for (let i = 0; i < 2; i++) {
      const q: number[] = [];
      ring(q, 0.045 + i * 0.05, 0.12, 0.09, 8);
      ring(q, 0.06 + i * 0.05, 0.121, 0.091, 8);
      kit.mesh(spine, kit.hull(q), M.leatherDark);
    }
  }
  const chest = kit.joint(spine, 0, 0.15, 0);
  const ribs = kit.joint(chest);
  {
    const p: number[] = [];
    ring(p, -0.03, 0.115, 0.083, 8);
    ring(p, 0.09, 0.14, 0.098, 8, 0, 0.01);
    ring(p, 0.19, 0.152, 0.085, 8, 0, -0.008);
    ring(p, 0.245, 0.085, 0.06, 8, 0, -0.01);
    kit.mesh(ribs, kit.hull(p), M.fur);
    // 皮甲：前低后高的领口
    const a: number[] = [];
    ring(a, -0.05, 0.121, 0.089, 10);
    ring(a, 0.07, 0.148, 0.106, 10, 0, 0.012);
    a.push(...sym([0.118, 0.13, 0.075, 0.0, 0.098, 0.112, 0.152, 0.17, 0.0, 0.11, 0.215, -0.07, 0.0, 0.215, -0.082, 0.14, 0.15, 0.05]));
    kit.mesh(ribs, kit.hull(a), M.leather);
    // 鎏金 V 领包边
    for (const s of [1, -1]) {
      const v = [0.12, 0.172, 0.05, 0.128, 0.165, 0.058, 0.0, 0.095, 0.116, 0.0, 0.088, 0.112, 0.0, 0.1, 0.104];
      kit.mesh(ribs, kit.hull(s > 0 ? v : mirrorX(v)), M.gold);
    }
    // 前襟：朱红系带 + 三颗金扣
    kit.mesh(ribs, kit.hull(sym([0.013, -0.048, 0.096, 0.013, -0.048, 0.086, 0.014, 0.02, 0.113, 0.014, 0.02, 0.103, 0.011, 0.086, 0.118, 0.011, 0.086, 0.108])), M.vermilion);
    for (let i = 0; i < 3; i++) {
      const y = -0.025 + i * 0.04;
      kit.mesh(ribs, Geo.octa(0.008), M.gold, 0, y, 0.101 + i * 0.0085, 0, 0, 0, 1, 1, 0.6);
    }
    // 皮甲下摆的鎏金包边
    {
      const q: number[] = [];
      ring(q, -0.056, 0.124, 0.092, 10);
      ring(q, -0.042, 0.125, 0.093, 10);
      kit.mesh(ribs, kit.hull(q), M.gold);
    }
    // 白色胸毛（V 领内）
    kit.mesh(ribs, kit.hull(sym([0.07, 0.215, 0.05, 0.1, 0.17, 0.04, 0.0, 0.08, 0.108, 0.04, 0.12, 0.098, 0.0, 0.2, 0.085, 0.0, 0.17, 0.1])), M.white);
    // 肩带
    for (const s of [1, -1]) {
      kit.mesh(ribs, kit.hull(s > 0 ? [0.08, 0.235, 0.05, 0.12, 0.215, 0.05, 0.08, 0.235, -0.06, 0.12, 0.215, -0.065, 0.1, 0.25, 0.0, 0.13, 0.225, 0.0]
        : mirrorX([0.08, 0.235, 0.05, 0.12, 0.215, 0.05, 0.08, 0.235, -0.06, 0.12, 0.215, -0.065, 0.1, 0.25, 0.0, 0.13, 0.225, 0.0])), M.leatherDark);
    }
    // 背后箭袋式皮扣
    kit.mesh(ribs, kit.hull(bevelBox(-0.06, 0.06, 0.02, 0.15, -0.115, -0.09, 0.01)), M.leatherDark);
    kit.mesh(ribs, Geo.cyl(0.02, 0.02, 0.01, 8), M.gold, 0, 0.09, -0.118, Math.PI / 2, 0, 0);
  }

  // 朱红围巾：领圈 + 两条飘带
  const scarfTails: THREE.Group[][] = [];
  {
    // 两圈叠绕的领巾（下宽上窄，前低后高）
    for (let i = 0; i < 2; i++) {
      const q: number[] = [];
      ring(q, 0.0, 0.098 - i * 0.012, 0.086 - i * 0.01, 9, 0, 0.004);
      ring(q, 0.04, 0.084 - i * 0.012, 0.074 - i * 0.01, 9, 0, 0.004);
      kit.mesh(chest, kit.hull(q), M.vermilion, 0, 0.212 + i * 0.036, -0.008, 0.2 - i * 0.08, 0, i ? -0.06 : 0.05);
    }
    kit.mesh(chest, kit.fluff(rand, 0, 0, 0, 0.04, 0.035, 0.03, 10, 0.1), M.vermilion, 0.062, 0.215, 0.085);
    kit.mesh(chest, Geo.octa(0.014), M.glow, 0.066, 0.215, 0.118, 0, 0, 0, 1, 1.4, 0.6);
    const strip = (w0: number, w1: number, len: number): THREE.BufferGeometry =>
      kit.hull([-w0, 0, -0.008, w0, 0, -0.008, -w0, 0, 0.008, w0, 0, 0.008, -w1, -len, -0.006, w1, -len, -0.006, -w1, -len, 0.006, w1, -len, 0.006]);
    const specs = [
      { x: 0.03, rz: 0.22, ry: 0.35, lens: [0.16, 0.15, 0.12], w: [0.03, 0.028, 0.024, 0.015] },
      { x: 0.08, rz: 0.6, ry: 0.6, lens: [0.13, 0.12, 0.1], w: [0.026, 0.024, 0.02, 0.012] },
    ];
    for (const s of specs) {
      const base = kit.joint(chest, s.x, 0.22, -0.09, 0.32, s.ry, s.rz);
      const chain: THREE.Group[] = [];
      let parent: THREE.Object3D = base;
      for (let i = 0; i < s.lens.length; i++) {
        const j = kit.joint(parent, 0, i === 0 ? 0 : -s.lens[i - 1], 0);
        kit.mesh(j, strip(s.w[i], s.w[i + 1], s.lens[i] + 0.008), M.vermilion);
        chain.push(j);
        parent = j;
      }
      kit.mesh(chain[chain.length - 1], kit.hull([-s.w[3], -s.lens[2] + 0.01, -0.007, s.w[3], -s.lens[2] + 0.01, -0.007, -s.w[3], -s.lens[2] + 0.01, 0.007, s.w[3], -s.lens[2] + 0.01, 0.007, 0, -s.lens[2] - 0.035, 0]), M.gold);
      scarfTails.push(chain);
    }
  }

  // ═════════════════════════════ 头部 ═════════════════════════════
  const neck = kit.joint(chest, 0, 0.245, -0.012);
  kit.mesh(neck, kit.limb([{ y: 0.01, rx: 0.056, rz: 0.056 }, { y: -0.085, rx: 0.048, rz: 0.05, cz: 0.005 }], 7), M.fur);
  kit.mesh(neck, kit.hull(sym([0.05, 0.085, 0.022, 0.054, 0.015, 0.03, 0.0, 0.0, 0.064, 0.0, 0.09, 0.05, 0.03, 0.05, 0.058])), M.white);
  // 喉下白色毛领：填满下颌与围巾之间，尖毛朝下
  kit.mesh(neck, kit.fluff(rand, 0, 0.045, 0.048, 0.054, 0.04, 0.036, 14, 0.14, 7, 0.34, -0.5), M.white);
  const head = kit.joint(neck, 0, 0.064, 0.014);
  head.rotation.order = 'YXZ';
  const hg = kit.joint(head);
  hg.scale.setScalar(HEAD_SCALE);
  {
    // 颅顶（赤橙）
    kit.mesh(hg, kit.hull(sym([
      0.0, 0.195, -0.02, 0.055, 0.185, 0.03, 0.085, 0.165, -0.04, 0.1, 0.11, -0.05, 0.075, 0.1, -0.115,
      0.0, 0.13, -0.12, 0.0, 0.04, -0.1, 0.07, 0.03, -0.07, 0.108, 0.08, 0.0, 0.085, 0.13, 0.06,
      0.04, 0.148, 0.085, 0.0, 0.152, 0.09, 0.09, 0.04, 0.03,
    ])), M.fur);
    // 吻部上侧（赤橙）
    kit.mesh(hg, kit.hull(sym([
      0.05, 0.125, 0.09, 0.0, 0.14, 0.095, 0.06, 0.075, 0.095, 0.022, 0.088, 0.212, 0.0, 0.093, 0.212, 0.026, 0.066, 0.216,
    ])), M.fur);
    // 白色口吻与下颌
    kit.mesh(hg, kit.hull(sym([
      0.064, 0.088, 0.065, 0.078, 0.05, 0.045, 0.04, 0.032, 0.168, 0.027, 0.066, 0.208, 0.0, 0.042, 0.206,
      0.0, 0.012, 0.12, 0.05, 0.014, 0.06, 0.036, 0.078, 0.16,
    ])), M.white);
    // 腮毛：脸颊白底 + 三簇向后下方翘起的尖毛
    for (const s of [1, -1]) {
      const a = [0.066, 0.098, 0.05, 0.096, 0.088, 0.0, 0.098, 0.04, 0.02, 0.07, 0.0, 0.03, 0.082, 0.03, -0.045, 0.1, 0.07, -0.03];
      kit.mesh(hg, kit.hull(s > 0 ? a : mirrorX(a)), M.white);
      const tufts = [
        [0.088, 0.072, 0.0, 0.15, 0.052, -0.06, 0.022],
        [0.086, 0.04, 0.0, 0.156, 0.0, -0.05, 0.022],
        [0.074, 0.012, 0.015, 0.124, -0.042, -0.035, 0.018],
      ];
      for (const [bx, by, bz, tx, ty, tz, w] of tufts) {
        const pts = [bx, by + w, bz + w, bx, by + w, bz - w, bx, by - w, bz + w, bx, by - w, bz - w, bx - 0.02, by, bz, tx, ty, tz];
        kit.mesh(hg, kit.hull(s > 0 ? pts : mirrorX(pts)), M.white);
      }
    }
    // 鼻头
    kit.mesh(hg, kit.hull(sym([0.018, 0.088, 0.209, 0.0, 0.097, 0.207, 0.016, 0.073, 0.222, 0.0, 0.067, 0.231, 0.0, 0.09, 0.225, 0.01, 0.064, 0.221])), M.nose);
    // 嘴线
    for (const s of [1, -1]) {
      const m = [0.02, 0.046, 0.204, 0.024, 0.04, 0.2, 0.06, 0.05, 0.1, 0.058, 0.044, 0.1, 0.028, 0.044, 0.208];
      kit.mesh(hg, kit.hull(s > 0 ? m : mirrorX(m)), M.nose);
    }
    // 额前刘海与后脑鬃毛（深赤）
    kit.mesh(hg, kit.hull(sym([0.04, 0.188, -0.02, 0.0, 0.208, -0.04, 0.0, 0.178, 0.085, 0.022, 0.168, 0.06, 0.03, 0.19, 0.02])), M.furDeep);
    kit.mesh(hg, kit.hull(sym([0.05, 0.16, -0.09, 0.0, 0.185, -0.08, 0.0, 0.02, -0.135, 0.04, 0.06, -0.115, 0.0, 0.1, -0.14])), M.furDeep);
    // 额前火纹
    kit.mesh(hg, Geo.octa(0.012), M.glow, 0, 0.158, 0.092, -0.75, 0, 0, 0.9, 2.0, 0.5);
    kit.mesh(hg, Geo.octa(0.006), M.glowCore, 0, 0.152, 0.096, -0.75, 0, 0, 1, 1.6, 0.5);
  }
  // 眼睛（眼线 + 发光虹膜 + 竖瞳 + 泪痕）
  const eyes: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const eye = kit.joint(hg, s * 0.057, 0.118, 0.088, -0.15, s * 0.56, s * -0.12);
    eye.scale.setScalar(EYE_S);
    const shape = (k: number, z: number): number[] => {
      const p = [-0.022, -0.004, 0.0, -0.002, 0.009, 0.0, 0.024, 0.009, 0.0, 0.006, -0.008, 0.0];
      const out: number[] = [];
      for (let i = 0; i < p.length; i += 3) out.push(s * p[i] * k, p[i + 1] * k, z, s * p[i] * k, p[i + 1] * k, z + 0.004);
      return out;
    };
    kit.mesh(eye, kit.hull(shape(1.3, -0.004)), M.nose);
    kit.mesh(eye, kit.hull(shape(1, 0.0)), M.eye);
    kit.mesh(eye, Geo.box(0.0035, 0.015, 0.002), M.nose, s * 0.002, 0.001, 0.005);
    kit.mesh(eye, Geo.box(0.004, 0.004, 0.002), M.glowCore, s * -0.006, 0.004, 0.006);
    // 泪痕：从内眼角斜向口吻
    const tear = [-0.024, -0.002, -0.003, -0.018, -0.008, -0.003, -0.03, -0.03, -0.006, -0.026, -0.034, -0.006, -0.024, -0.004, 0.002, -0.028, -0.03, 0.0];
    kit.mesh(eye, kit.hull(s > 0 ? tear : mirrorX(tear)), M.nose);
    eyes.push(eye);
  }
  // 耳朵（外赤橙、内白绒、黑耳尖）
  const ears: THREE.Group[] = [];
  for (const s of [1, -1]) {
    const ear = kit.joint(hg, s * 0.062, 0.165, -0.03);
    ear.rotation.order = 'YXZ';
    const outer = sym([0.052, 0, 0.012, 0.042, 0, -0.025, 0.0, 0, -0.036, 0.0, 0.162, -0.012, 0.042, 0.066, 0.004, 0.0, 0.075, -0.032]);
    kit.mesh(ear, kit.hull(outer), M.fur);
    kit.mesh(ear, kit.hull(sym([0.03, 0.092, 0.006, 0.0, 0.092, -0.026, 0.0, 0.17, -0.012, 0.018, 0.13, 0.0])), M.black);
    kit.mesh(ear, kit.hull(sym([0.034, 0.012, 0.016, 0.03, 0.012, 0.008, 0.0, 0.115, 0.004, 0.0, 0.115, -0.002])), M.white);
    for (const [tx, ty] of [[-0.03, 0.07], [0.0, 0.085], [0.028, 0.065]]) {
      kit.mesh(ear, kit.hull([-0.016, 0.01, 0.014, 0.016, 0.01, 0.014, 0.0, 0.01, 0.0, 0.0, 0.03, 0.02, tx, ty, 0.02]), M.white);
    }
    if (s > 0) kit.mesh(ear, Geo.torus(0.014, 0.0032, 4, 10), M.gold, 0.042, 0.03, 0.0, 0, Math.PI / 2 - 0.3, 0);
    ears.push(ear);
  }

  // ═════════════════════════════ 手臂 ═════════════════════════════
  interface Arm { shoulder: THREE.Group; elbow: THREE.Group; wrist: THREE.Group }
  const buildArm = (side: number): Arm => {
    const shoulder = kit.joint(chest, side * SHOULDER_X, 0.19, -0.01);
    kit.mesh(shoulder, kit.fluff(rand, 0, -0.02, 0, 0.062, 0.064, 0.058, 12, 0.08), M.fur);
    kit.mesh(shoulder, kit.limb([
      { y: 0, rx: 0.051, rz: 0.05 },
      { y: 0.09, rx: 0.054, rz: 0.051, cz: -0.004 },
      { y: UPPER, rx: 0.036, rz: 0.038 },
    ], 7), M.fur);
    const elbow = kit.joint(shoulder, 0, -UPPER, 0);
    kit.mesh(elbow, kit.hull([0, 0.03, -0.03, 0.032, 0.0, -0.022, -0.032, 0.0, -0.022, 0, -0.07, -0.062, 0.02, -0.04, -0.03, -0.02, -0.04, -0.03, 0, 0.0, 0.01]), M.fur);
    kit.mesh(elbow, kit.limb([
      { y: -0.01, rx: 0.038, rz: 0.038 },
      { y: 0.06, rx: 0.042, rz: 0.042 },
      { y: FORE, rx: 0.028, rz: 0.026 },
    ], 7), M.black);
    kit.mesh(elbow, kit.limb([{ y: 0.07, rx: 0.048, rz: 0.048 }, { y: 0.215, rx: 0.036, rz: 0.034 }], 7), M.leather);
    kit.mesh(elbow, kit.limb([{ y: 0.062, rx: 0.051, rz: 0.051 }, { y: 0.082, rx: 0.05, rz: 0.05 }], 7), M.gold);
    kit.mesh(elbow, kit.limb([{ y: 0.2, rx: 0.039, rz: 0.037 }, { y: 0.214, rx: 0.038, rz: 0.036 }], 7), M.vermilion);
    const wrist = kit.joint(elbow, 0, -FORE, 0);
    kit.mesh(wrist, Geo.ico(0.03, 0), M.black);
    return { shoulder, elbow, wrist };
  };
  const armL = buildArm(1);
  const armR = buildArm(-1);

  // 左肩：朱漆鎏金肩甲（两层）
  {
    const sh = armL.shoulder;
    const plate = (y0: number, y1: number, r0: number, r1: number): number[] => {
      const out: number[] = [];
      for (let i = 0; i <= 6; i++) {
        const a = -1.1 + (i / 6) * 2.2;
        out.push(0.02 + Math.cos(a) * r0 * 0.6, y0, Math.sin(a) * r0);
        out.push(Math.cos(a) * r1, y1, Math.sin(a) * r1 * 1.05);
      }
      out.push(-0.02, y0 + 0.01, 0);
      return out;
    };
    kit.mesh(sh, kit.hull(plate(0.045, -0.04, 0.06, 0.082)), M.vermilion, 0.012, 0, 0, 0, 0, -0.35);
    kit.mesh(sh, kit.hull(plate(-0.035, -0.045, 0.082, 0.086)), M.gold, 0.012, 0, 0, 0, 0, -0.35);
    kit.mesh(sh, kit.hull(plate(-0.03, -0.11, 0.07, 0.078)), M.vermilion, 0.028, 0, 0, 0, 0, -0.5);
    kit.mesh(sh, kit.hull(plate(-0.104, -0.114, 0.077, 0.079)), M.gold, 0.028, 0, 0, 0, 0, -0.5);
  }
  // 右肩：皮质护肩带
  kit.mesh(armR.shoulder, kit.hull(sym([0.045, 0.03, 0.05, 0.05, -0.02, 0.058, 0.0, 0.06, 0.03])), M.leatherDark, -0.02, -0.01, 0, 0, Math.PI / 2, 0.2);

  // 右手：握住冲锋枪握把的拳（在枪空间里造型，腕关节朝向 = 枪朝向）
  {
    const g = kit.joint(armR.wrist, -WRIST_IN_GUN.x, -0.055 - WRIST_IN_GUN.y, 0.035 - WRIST_IN_GUN.z, -0.3, 0, 0);
    kit.mesh(g, kit.hull(bevelBox(-0.044, 0.03, -0.048, 0.042, -0.012, 0.042, 0.012)), M.black);
    for (let i = 0; i < 4; i++) {
      const y0 = 0.032 - i * 0.022;
      kit.mesh(g, kit.hull(bevelBox(-0.034, 0.032, y0 - 0.019, y0, -0.046, -0.006, 0.006)), M.black);
    }
    kit.mesh(g, kit.hull([0.024, 0.03, 0.02, 0.036, 0.03, 0.025, 0.03, 0.05, 0.03, 0.03, 0.085, -0.01, 0.038, 0.08, -0.016, 0.034, 0.07, 0.0]), M.black);
    // 腕甲到拳之间的过渡
    kit.mesh(armR.wrist, kit.hull(bevelBox(-0.03, 0.026, -0.03, 0.02, -0.02, 0.03, 0.01)), M.black, 0.004, 0.01, -0.01);
  }
  // 左手：掌心向上托着狐火
  const foxfire = kit.joint(armL.wrist, 0, -0.058, 0.03, Math.PI / 2, 0, 0);
  const sparks: THREE.Object3D[] = [];
  let palmFlame: Flame | null = null;
  {
    const w = armL.wrist;
    kit.mesh(w, kit.hull(bevelBox(-0.034, 0.034, -0.085, 0.0, -0.016, 0.012, 0.008)), M.black);
    for (let i = 0; i < 4; i++) {
      const x = -0.026 + i * 0.0175;
      const len = i === 0 || i === 3 ? 0.032 : 0.04;
      const f = kit.joint(w, x, -0.083, 0.0, 0.25, 0, 0);
      kit.mesh(f, kit.hull(bevelBox(-0.0075, 0.0075, -len, 0.0, -0.01, 0.009, 0.003)), M.black);
      const f2 = kit.joint(f, 0, -len, 0, 0.45, 0, 0);
      kit.mesh(f2, kit.hull(bevelBox(-0.0068, 0.0068, -0.026, 0.002, -0.008, 0.008, 0.003)), M.black);
      kit.mesh(f2, Geo.cone(0.005, 0.014, 4), M.white, 0, -0.03, 0.002, Math.PI, 0, 0);
    }
    const th = kit.joint(w, 0.03, -0.018, 0.004, 0.2, 0, -0.6);
    kit.mesh(th, kit.hull(bevelBox(-0.009, 0.009, -0.05, 0.0, -0.01, 0.01, 0.004)), M.black);
    // 狐火（掌心一团，周围绕着三颗火星）
    palmFlame = makeFlame(foxfire, 0.04, 0, 0.012, 0, 4, 3);
    kit.mesh(foxfire, Geo.ico(0.02, 0), M.glowCore, 0, 0.03, 0);
    for (let i = 0; i < 3; i++) {
      const sp = kit.joint(foxfire, 0, 0.05, 0, 0, (i / 3) * Math.PI * 2, 0);
      kit.mesh(sp, Geo.octa(0.008), M.glowMid, 0.065, 0.02 * i, 0);
      sparks.push(sp);
    }
  }

  // ═════════════════════════════ 枪挂点 ═════════════════════════════
  const gun = kit.joint(chest);
  gun.name = 'fox:hand';
  const GUN_IDLE_P = new THREE.Vector3(-0.236, -0.266, 0.308);
  const GUN_IDLE_Q = quatYXZ(-0.8, Math.PI - 0.12, 0.0);
  const GUN_UP_P = new THREE.Vector3(-0.2, 0.12, 0.2);
  const GUN_UP_Q = aimBasis(new THREE.Vector3(-0.26, 1, 0.22), new THREE.Vector3(0.25, 0, -1));
  const POLE_R_IDLE = new THREE.Vector3(-0.45, 0, -0.7);
  const POLE_R_UP = new THREE.Vector3(-0.8, -1, 0);
  const L_IDLE_P = new THREE.Vector3(0.2, -0.1, 0.2);
  const L_UP_P = new THREE.Vector3(0.3, 0.02, 0.24);
  const L_IDLE_Q = handBasis(new THREE.Vector3(0.15, 0.08, 1), new THREE.Vector3(0, 1, 0));
  const L_UP_Q = handBasis(new THREE.Vector3(0.55, 0.15, 0.8), new THREE.Vector3(0, 1, 0));
  const POLE_L = new THREE.Vector3(0.35, -0.5, -0.8);
  const _lq = new THREE.Quaternion();

  // ═════════════════════════════ 尾巴 ═════════════════════════════
  interface Tail { spec: TailSpec; spread: THREE.Group; mesh: THREE.SkinnedMesh; joints: THREE.Bone[]; flame: Flame }
  const tailMount = kit.joint(hips, 0, -0.03, -0.1);
  const tailFur = kit.std(0xffffff, 0.85);
  tailFur.vertexColors = true;
  const cDeep = new THREE.Color(C.furDeep);
  const cFur = new THREE.Color(C.fur);
  const cLight = new THREE.Color(C.furLight);
  const cWhite = new THREE.Color(C.white);
  const tailColor = (u: number, out: THREE.Color): void => {
    if (u < 0.14) out.copy(cDeep).lerp(cFur, u / 0.14);
    else if (u < 0.66) out.copy(cFur);
    else if (u < 0.76) out.copy(cFur).lerp(cLight, (u - 0.66) / 0.1);
    else if (u < 0.84) out.copy(cLight).lerp(cWhite, (u - 0.76) / 0.08);
    else out.copy(cWhite);
  };
  const NT = TAIL_LEN.length;
  const tails: Tail[] = TAILS.map((spec) => {
    const spread = kit.joint(tailMount);
    spread.scale.setScalar(spec.scale);
    const tail = buildFoxTail(tailFur, { lengths: TAIL_LEN, radii: TAIL_R, radial: 9, tufts: 11, rand, color: tailColor });
    kit.own(tail.mesh.geometry);
    kit.extra.push(tail.mesh.skeleton);
    spread.add(tail.mesh);
    const flame = makeFlame(tail.bones[NT], 0.07, 0, 0.05, 0, 4, 2);
    return { spec, spread, mesh: tail.mesh, joints: tail.bones, flame };
  });

  // ═════════════════════════════ 动画 ═════════════════════════════
  const fan = new Spring(1, 170, 11);
  const flare = new Spring(0, 90, 15);
  const raise = new Spring(0, 120, 19);
  const turn = new Spring(0, 60, 13);
  const headTurn = new Spring(0, 40, 11);
  const crouch = new Spring(0, 220, 24);
  let introT = -1;
  const INTRO_LEN = 1.9;
  const glowBase = new THREE.Color(C.glow);
  const glowHot = new THREE.Color(0xff8a24);
  const midBase = new THREE.Color(C.glowMid);
  const midHot = new THREE.Color(0xffd23c);

  const update = (dt: number, t: number): void => {
    // ── 亮相时间线 → 弹簧目标 ──
    if (introT >= 0) {
      introT += dt;
      if (introT > INTRO_LEN) introT = -1;
    }
    const it = introT;
    const on = it >= 0;
    crouch.target = on && it < 0.16 ? 1 : 0;
    fan.target = !on ? 1 : it < 0.12 ? 0.82 : it < 1.05 ? 1.42 : 1;
    flare.target = on && it > 0.12 && it < 1.05 ? 1 : 0;
    turn.target = on && it > 0.06 && it < 1.1 ? 1 : 0;
    raise.target = on && it > 0.16 && it < 1.0 ? 1 : 0;
    headTurn.target = turn.target;
    const cr = crouch.step(dt);
    const fa = fan.step(dt);
    const fl = flare.step(dt);
    const ra = raise.step(dt);
    const tu = turn.step(dt);
    const ht = headTurn.step(dt);

    // ── 身体：呼吸、重心、转身 ──
    const br = Math.sin((t * Math.PI * 2) / 3.8);
    const sway = Math.sin(t * 0.55);
    hips.position.set(-0.016 + 0.006 * sway, HIP_Y - 0.035 * cr - 0.003 * (1 - br) * 0.5, 0.01 * tu);
    hips.rotation.set(0.05 + 0.02 * cr, -0.18 * tu, -0.045 + 0.008 * sway);
    const hz = hips.rotation.z;
    const hy = hips.rotation.y;
    legR.hip.rotation.set(-0.04 - 0.22 * cr, -hy - 0.08, -hz - 0.06);
    legR.knee.rotation.set(0.03 + 0.45 * cr, 0, 0);
    legR.ankle.rotation.set(-0.0 - 0.25 * cr, 0, hz * 0.5 + 0.02);
    legL.hip.rotation.set(-0.16 - 0.2 * cr - 0.08 * tu, -hy + 0.28, -hz + 0.1);
    legL.knee.rotation.set(0.22 + 0.4 * cr + 0.08 * tu, 0, 0);
    legL.ankle.rotation.set(-0.08 - 0.22 * cr, 0, hz * 0.5 - 0.06);

    spine.rotation.set(-0.05 + 0.012 * br + 0.06 * cr, -0.13 * tu, 0.035 - 0.005 * sway);
    chest.rotation.set(-0.01 - 0.02 * br, -0.13 * tu, 0.04 - 0.004 * sway);
    chest.position.y = 0.15 + 0.003 * br;
    ribs.scale.set(1 + 0.008 * br, 1, 1 + 0.018 * br);

    // ── 头：环顾 + 好奇歪头；转身时回看镜头 ──
    // 环顾时偏向角色右前方（选人舞台的机位在那一侧），时不时瞟一眼镜头
    const lookY = -0.15 + 0.15 * Math.sin(t * 0.37 + 0.6) + 0.06 * Math.sin(t * 0.93 + 1.9);
    const lookX = -0.03 + 0.035 * Math.sin(t * 0.51 + 0.3);
    const totalTurn = 0.18 * tu + 0.26 * tu;
    neck.rotation.set(0.04 + 0.01 * br, lookY * 0.35 + ht * totalTurn * 0.35, 0);
    head.rotation.set(lookX - 0.06 * ra, lookY * 0.65 + ht * totalTurn * 0.6, 0.1 + 0.03 * Math.sin(t * 0.7) - 0.08 * ht);

    // ── 耳朵：随头部转动 + 偶尔抖动 ──
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? 1 : -1;
      const tw = pulse(t, i === 0 ? 4.3 : 5.1, i === 0 ? 1.1 : 3.4, 0.22);
      ears[i].rotation.set(-0.16 - 0.35 * tw - 0.12 * fl, s * (0.25 + 0.08 * tw), s * (-0.26 - 0.12 * tw) + lookY * -0.15);
    }
    // 眨眼
    const blink = pulse(t, 4.7, 0.6, 0.16);
    for (let i = 0; i < 2; i++) eyes[i].scale.set(EYE_S, EYE_S * (1 - 0.88 * blink), EYE_S);

    // ── 枪 + 右臂 IK ──
    const rc = clamp01(ra);
    gun.position.lerpVectors(GUN_IDLE_P, GUN_UP_P, ra);
    gun.position.y += 0.004 * br;
    gun.quaternion.slerpQuaternions(GUN_IDLE_Q, GUN_UP_Q, rc);
    _e.set(0.03 * Math.sin(t * 0.8), 0, 0.02 * Math.sin(t * 0.6));
    _q.setFromEuler(_e);
    gun.quaternion.multiply(_q);
    _p.copy(WRIST_IN_GUN).applyQuaternion(gun.quaternion).add(gun.position);
    _pole.lerpVectors(POLE_R_IDLE, POLE_R_UP, rc);
    solveArm(armR.shoulder, armR.elbow, armR.wrist, UPPER, FORE, _p, _pole, gun.quaternion);

    // ── 左臂：托狐火 ──
    const lf = clamp01(Math.max(fl, ra * 0.8));
    _v.lerpVectors(L_IDLE_P, L_UP_P, lf);
    _v.y += 0.006 * br + 0.004 * Math.sin(t * 1.3);
    _lq.slerpQuaternions(L_IDLE_Q, L_UP_Q, lf);
    solveArm(armL.shoulder, armL.elbow, armL.wrist, UPPER, FORE, _v, POLE_L, _lq);
    const ff = (1 + 0.7 * fl) * (1 + 0.08 * Math.sin(t * 9.1) + 0.05 * Math.sin(t * 14.7));
    foxfire.scale.set(ff * (1 - 0.04 * Math.sin(t * 9.1)), ff, ff);
    foxfire.position.z = 0.03 + 0.006 * Math.sin(t * 2.1);
    if (palmFlame) {
      uprightFlame(palmFlame, 0.85);
      flicker(palmFlame, t, 0.7);
    }
    for (let i = 0; i < sparks.length; i++) sparks[i].rotation.y = t * 2.4 + (i / 3) * Math.PI * 2;

    // ── 尾巴：逐节波动 + 扇形展开 ──
    const fo = fa - 1;
    for (let k = 0; k < tails.length; k++) {
      const tl = tails[k];
      const sp = tl.spec;
      const ph = sp.phase;
      // 扇形展开：扫出方向向外张、尾根上扬、尾巴伸直并炸毛
      tl.spread.rotation.set(0, sp.yaw + sp.open * fo + 0.04 * Math.sin(t * 0.6 + ph), sp.roll + 0.03 * Math.sin(t * 0.45 + ph));
      tl.spread.scale.setScalar(sp.scale * (1 + fo * 0.09));
      const curlK = 1 - fo * 0.18;
      const n = tl.joints.length;
      for (let i = 0; i < n; i++) {
        const w = (i + 1) / n;
        const j = tl.joints[i];
        const wave = Math.sin(t * 1.25 - i * 0.62 + ph);
        const side = Math.sin(t * 0.83 - i * 0.5 + ph + 1.7);
        const rx = i === 0 ? -Math.PI / 2 + sp.lift + sp.rise * fo : sp.curl[i] * curlK;
        j.rotation.set(rx + 0.07 * w * wave, 0, sp.side[i] + 0.09 * w * side);
      }
      const fs = 1 + 0.2 * fl;
      tl.flame.root.scale.set(fs, fs * (1 + 0.06 * Math.sin(t * 6.1 + k * 2.1)), fs);
      uprightFlame(tl.flame, 0.7);
      flicker(tl.flame, t, k * 1.9);
    }
    const hot = clamp01(fl);
    M.glow.color.copy(_c.copy(glowBase).lerp(glowHot, hot));
    M.glowMid.color.copy(_c.copy(midBase).lerp(midHot, hot));
    M.flame.color.setRGB(1, 1 + 0.4 * hot, 1 + 0.5 * hot);
    M.flameCore.color.setRGB(1, 1 + 0.15 * hot, 1 + 0.3 * hot);

    // ── 围巾飘带：跟随转身的滞后 ──
    for (let s = 0; s < scarfTails.length; s++) {
      const chain = scarfTails[s];
      for (let i = 0; i < chain.length; i++) {
        const w = (i + 1) / chain.length;
        chain[i].rotation.x = (i === 0 ? 0 : 0.12) + 0.07 * w * Math.sin(t * 1.4 - i * 0.8 + s) + turn.v * 0.03 * w;
        chain[i].rotation.z = 0.06 * w * Math.sin(t * 1.1 - i * 0.6 + s * 2) - turn.v * 0.04 * w;
      }
    }
  };

  update(0, 0);
  // 预览台按各网格 geometry.boundingBox 量英雄的占地范围：蒙皮尾巴的几何包围盒是伸直的绑定姿态，
  // 这里换成待机姿态下的实际范围（略放大以含尾尖火焰与摆动），让取景能把张开的尾巴放进画面
  root.updateMatrixWorld(true);
  for (const tl of tails) {
    tl.mesh.computeBoundingBox();
    if (!tl.mesh.boundingBox) continue;
    const box = tl.mesh.boundingBox.clone().expandByScalar(0.04);
    tl.mesh.geometry.boundingBox = box;
    tl.mesh.geometry.boundingSphere = box.getBoundingSphere(new THREE.Sphere());
  }

  return {
    root,
    height: 1.9,
    hand: gun,
    materials: kit.mats,
    update,
    playIntro() {
      introT = 0;
    },
    dispose() {
      kit.dispose();
    },
  };
}

