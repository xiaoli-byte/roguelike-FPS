import * as THREE from 'three';
import { clamp01, ellipsoid, labCombine, labReference, mergeParts, proceduralLit, rng, smooth, srgb, triangles, tube, yawBox } from './flora';
import type { BuiltPiece, LabPiece, PieceBox, PieceContext, V2, V3 } from './types';

/**
 * 半埋驼骨（1-1 古道边 ×1，近景叙事件）：一具侧卧的骆驼骨架半埋在一小道沙堆里，约 3 × 1.5 m、露出 0.8 m。
 * 头骨 + 微张的下颌、往回弯的长脖子（死时颈往背上折，骆驼骨最认得出的姿势）、一溜脊椎和背棘、
 * 上侧一排拱出沙面的肋骨（有几根断了）、肩胛和盆骨、两条腿骨斜伸出沙，另有一根散落的长骨。
 * 程序化建模，骨头 = StylizedLit（漂白的骨色顶点色，贴沙处沾沙），沙堆 = 同一套光照、参数照沙漠地形材质（暗部、边缘光），
 * 沙堆每个顶点按 ctx.ground 贴地，边沿压到地面以下一点盖住接缝。
 *
 * 件的本地坐标：+x = 头的方向（脊柱沿 x，尾在 −x），+z = 背侧，−z = 腹侧（肋拱向 −z 落进沙），y 向上；整件绕 y 转 rotDeg。
 */

// 骨色对着商队残骸（SM_Tripo_DesertCaravanWreck）里那副驼骨调：暖象牙色，不是纯白
const BONE = srgb(0.79, 0.71, 0.57);
const BONE_END = srgb(0.66, 0.57, 0.43);
const BONE_DARK = srgb(0.2, 0.15, 0.11);
const BONE_STAIN = srgb(0.68, 0.54, 0.38);
/** 第一章地形沙层贴图的平均色（unity-levels 1-1 地形第 0 层 ≈ 0.86, 0.67, 0.45） */
const SAND = srgb(0.85, 0.66, 0.45);

/** 沙堆：参数照沙漠地形材质（UnityStylizedLit 的 DESERT / TERRAIN_CONSTANTS）——软阶梯、暗部抬升 0.22、边缘光很弱 */
function sandMaterial(ctx: PieceContext): THREE.MeshStandardMaterial {
  return proceduralLit('M_Proc_SandDrift', () => ({
    floats: { _RampThreshold: 0, _RampSoftness: 0.3, _ShadowLift: 0.22, _RimStrength: 0.05, _RimPower: 5 },
    colors: { _ShadowTint: [0.7, 0.64, 0.82, 1] },
  }), ctx.environment);
}

export interface CamelBonesOptions {
  /** 沙堆的颜色（sRGB 0..1）：按所在地形的沙色调，缺省暖沙色 */
  sand?: [number, number, number];
}

export function buildCamelBones(at: V2, y: number, rotDeg: number, ctx: PieceContext, options: CamelBonesOptions = {}): BuiltPiece {
  const low = ctx.low;
  const rand = rng(52027);
  const yaw = THREE.MathUtils.degToRad(rotDeg);
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
  const origin = new THREE.Vector3(at[0], y, at[1]);
  /** 件本地 → 世界 */
  const toWorld = (p: THREE.Vector3) => p.clone().applyQuaternion(rot).add(origin);
  /** 本地点处的沙面高度（本地 y）：地形 + 沙堆 */
  const groundLocal = (lx: number, lz: number) => {
    const w = toWorld(new THREE.Vector3(lx, 0, lz));
    return ctx.ground(w.x, w.z) - y;
  };

  // ── 沙堆：顺着身子的一道椭圆沙丘，背风（背侧 +z）陡一点，身子底下垫高 ──
  const moundH = (lx: number, lz: number) => {
    const ex = (lx + 0.2) / 1.7, ez = (lz + 0.02) / (lz > 0 ? 0.78 : 0.9);
    const d = Math.hypot(ex, ez);
    const body = Math.exp(-Math.pow((lz - 0.25) / 0.35, 2)) * smooth(1.05, 0.2, Math.abs(ex)) * 0.06;
    if (d >= 1) return -0.05 * smooth(1, 1.15, d);
    return 0.28 * Math.pow(1 - d * d, 1.5) + body;
  };
  const sandLevel = (lx: number, lz: number) => groundLocal(lx, lz) + Math.max(0, moundH(lx, lz));

  const boneColor = (p: THREE.Vector3, end = 0) => {
    const above = p.y - sandLevel(p.x, p.z);
    // 骨端 / 低处发黄发暗（风格化 AO），贴沙的地方沾一圈沙色
    const c = BONE.clone().lerp(BONE_END, Math.max(end, smooth(0.35, 0, above) * 0.45));
    return c.lerp(BONE_STAIN, smooth(0.07, -0.02, above) * 0.6);
  };
  const parts: THREE.BufferGeometry[] = [];
  const sidesBig = low ? 6 : 9, sidesSmall = low ? 4 : 6;

  /** 长骨：两头鼓（骨骺），中段细 */
  const longBone = (a: THREE.Vector3, b: THREE.Vector3, r: number, bend = 0.04) => {
    const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, bend, 0));
    parts.push(tube({
      points: [a, mid, b],
      radius: s => r * (1 + 0.75 * Math.exp(-Math.pow(s / 0.08, 2)) + 0.6 * Math.exp(-Math.pow((1 - s) / 0.08, 2))),
      sides: sidesBig - 1, segments: low ? 6 : 9,
      color: (s, _phi, _k, p) => boneColor(p, smooth(0.2, 0.02, Math.min(s, 1 - s))),
      start: 'flat', end: 'flat', rand,
    }));
  };

  // ── 脊柱：尾 → 腰 → 胸（背棘越往肩越高，骆驼驼峰底下的长棘） ──
  const spine = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.25, 0.15, 0.3), new THREE.Vector3(-0.8, 0.19, 0.34), new THREE.Vector3(-0.3, 0.22, 0.37),
    new THREE.Vector3(0.15, 0.23, 0.36), new THREE.Vector3(0.52, 0.21, 0.3),
  ], false, 'centripetal');
  const vertebrae = low ? 12 : 18;
  for (let i = 0; i < vertebrae; i++) {
    const s = (i + 0.5) / vertebrae;
    const c = spine.getPointAt(s), t = spine.getTangentAt(s);
    const half = 0.034;
    parts.push(tube({
      points: [c.clone().addScaledVector(t, -half), c.clone().addScaledVector(t, half)],
      radius: () => 0.052, sides: sidesBig - 1, segments: 1,
      color: (_s, _phi, _k, p) => boneColor(p, 0.35),
      start: 'flat', end: 'flat', rand,
    }));
    // 背棘：朝背侧（+z）平躺、往尾的方向斜、半插进沙；胸段长、腰段短，长短不齐（有的断了、有的歪了）
    const len = (0.07 + 0.16 * smooth(0.35, 0.85, s) - 0.03 * smooth(0.92, 1, s)) * (0.7 + rand() * 0.5);
    const dir = new THREE.Vector3((rand() - 0.5) * 0.3, -0.12 + rand() * 0.25, 1).addScaledVector(t, -0.4).normalize();
    const root = c.clone().addScaledVector(dir, 0.03);
    const broken = rand() < 0.25;
    if (rand() < 0.15) continue;
    parts.push(tube({
      points: [root, root.clone().addScaledVector(dir, len * (broken ? 0.6 : 1))],
      radius: q => 0.019 * (1 - 0.5 * q), sides: sidesSmall - 1, segments: 2,
      shape: (_q, phi) => 1 + 0.45 * Math.cos(2 * phi), up: t,
      color: (_q, _phi, _k, p) => boneColor(p),
      end: broken ? 'broken' : 'flat', jag: 0.02, rand,
    }));
    // 腰段的横突：往上翘的一小片
    if (s < 0.45) {
      const up = new THREE.Vector3(0, 1, -0.25).normalize();
      parts.push(tube({
        points: [c.clone(), c.clone().addScaledVector(up, 0.11)],
        radius: q => 0.016 * (1 - 0.4 * q), sides: 4, segments: 1,
        shape: (_q, phi) => 1 + 0.5 * Math.cos(2 * phi), up: t,
        color: (_q, _phi, _k, p) => boneColor(p),
        end: 'flat', rand,
      }));
    }
  }
  // 尾椎：一溜小骨节拖进沙里
  for (let i = 0; i < 6; i++) {
    const f = i / 5;
    const c = new THREE.Vector3(-1.32 - f * 0.42, 0.13 - f * 0.11, 0.28 - f * 0.12 + Math.sin(f * 3) * 0.04);
    const r = 0.032 - f * 0.012;
    parts.push(ellipsoid(c, [r * 1.5, r, r], new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.3), 6, 4, (_d, p) => boneColor(p, 0.3)));
  }

  // ── 肋骨：上侧一排从脊柱拱起、越过身子落进腹侧的沙里；中间的最高，有三根断在半空 ──
  const ribs = low ? 8 : 11;
  for (let i = 0; i < ribs; i++) {
    const f = i / (ribs - 1);
    // 间距、高矮、扫角都抖一点：不能像梳子
    const x = -0.5 + f * 0.95 + (rand() - 0.5) * 0.05;
    const k = (0.62 + 0.38 * Math.sin(Math.PI * (0.25 + f * 0.75))) * (0.86 + rand() * 0.24);
    const sweep = -0.04 - 0.12 * k - rand() * 0.1;  // 往尾的方向扫
    const base = spine.getPointAt(clamp01((x + 1.25) / 1.77));
    const pts = [
      base.clone().add(new THREE.Vector3(0, 0.02, -0.02)),
      new THREE.Vector3(x + sweep * 0.25, 0.22 + 0.3 * k, 0.24),
      new THREE.Vector3(x + sweep * 0.55, 0.2 + 0.52 * k, 0.0),
      new THREE.Vector3(x + sweep * 0.8, 0.16 + 0.44 * k, -0.3 * k - 0.04),
      new THREE.Vector3(x + sweep, 0.08 + 0.14 * k, -0.48 * k - 0.08),
      new THREE.Vector3(x + sweep * 1.1, -0.08, -0.55 * k - 0.1),
    ];
    const broken = i === 2 || i === 6 || i === ribs - 2;
    const cut = broken ? 0.5 + rand() * 0.2 : 1;
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const ptsCut = cut < 1 ? Array.from({ length: 6 }, (_, j) => curve.getPointAt((j / 5) * cut)) : pts;
    parts.push(tube({
      points: ptsCut,
      radius: s => 0.028 * (1 - 0.3 * s * cut) * (1 + 0.4 * Math.exp(-Math.pow(s / 0.06, 2))),
      sides: sidesSmall - 1, segments: low ? 8 : 13,
      shape: (_s, phi) => 1 + 0.42 * Math.cos(2 * phi), up: new THREE.Vector3(1, 0, 0),
      color: (_s, _phi, _k, p) => boneColor(p),
      end: broken ? 'broken' : 'none', jag: 0.03, rand,
    }));
  }
  // 掉下来的两根肋：平躺在腹侧的沙上，一头埋着
  for (const [x0, z0, a, len] of [[-0.15, -0.78, 0.5, 0.75], [0.3, -0.9, -0.3, 0.6]] as const) {
    const dirF = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const side = new THREE.Vector3(-dirF.z, 0, dirF.x);
    const pts = [0, 0.33, 0.66, 1].map(f => new THREE.Vector3(x0, 0, z0).addScaledVector(dirF, (f - 0.5) * len)
      .addScaledVector(side, Math.sin(f * Math.PI) * 0.12));
    for (const p of pts) p.y = sandLevel(p.x, p.z) + 0.012;
    pts[0].y -= 0.05;
    parts.push(tube({
      points: pts, radius: s => 0.026 * (1 - 0.35 * s), sides: sidesSmall - 1, segments: low ? 5 : 8,
      shape: (_s, phi) => 1 + 0.42 * Math.cos(2 * phi), up: side,
      color: (_s, _phi, _k, p) => boneColor(p),
      end: 'broken', jag: 0.025, rand,
    }));
  }

  // ── 盆骨：髂骨翼半埋，斜着露出一片（肩胛早被沙埋了，不做——立着的扁片读起来像盘子） ──
  const pelvisRot = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3, -0.25, 0.12));
  parts.push(ellipsoid(new THREE.Vector3(-1.0, 0.2, 0.1), [0.24, 0.04, 0.15], pelvisRot, low ? 10 : 14, low ? 6 : 8, (_d, p) => boneColor(p, 0.2),
    d => 1 - 0.18 * Math.exp(-Math.pow((d.x + 0.1) / 0.25, 2) - Math.pow(d.z / 0.25, 2))));
  parts.push(ellipsoid(new THREE.Vector3(-1.05, 0.14, -0.12), [0.16, 0.045, 0.07], pelvisRot, 8, 5, (_d, p) => boneColor(p, 0.2)));

  // ── 腿：前腿（肱骨 + 前臂骨）、后腿（股骨 + 胫骨）斜伸出沙，一根散骨 ──
  longBone(new THREE.Vector3(0.52, 0.36, -0.12), new THREE.Vector3(0.34, 0.2, -0.5), 0.034);
  longBone(new THREE.Vector3(0.34, 0.2, -0.5), new THREE.Vector3(0.82, 0.02, -0.72), 0.028, 0.06);
  longBone(new THREE.Vector3(-0.92, 0.28, -0.08), new THREE.Vector3(-0.62, 0.17, -0.5), 0.036);
  longBone(new THREE.Vector3(-0.62, 0.17, -0.5), new THREE.Vector3(-1.08, -0.02, -0.76), 0.03, 0.05);
  longBone(new THREE.Vector3(0.12, 0.03, -0.82), new THREE.Vector3(-0.36, 0.05, -0.92), 0.026, 0.01);

  // ── 脖子：七节长颈椎从肩往前、再往背侧折回（死时颈往背上仰），头骨侧躺在背侧的沙上、吻朝尾 ──
  const neck = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.55, 0.2, 0.29), new THREE.Vector3(0.92, 0.27, 0.36), new THREE.Vector3(1.24, 0.25, 0.52),
    new THREE.Vector3(1.34, 0.17, 0.72), new THREE.Vector3(1.22, 0.11, 0.84),
  ], false, 'centripetal');
  const cervical = 7;
  for (let i = 0; i < cervical; i++) {
    const s0 = i / cervical + 0.02, s1 = (i + 1) / cervical - 0.02;
    const a = neck.getPointAt(s0), b = neck.getPointAt(s1);
    parts.push(tube({
      points: [a, a.clone().lerp(b, 0.5), b],
      // 两头鼓、中段细（骨节，不是一串香肠）
      radius: s => 0.03 * (1 + 0.75 * Math.exp(-Math.pow(s / 0.13, 2)) + 0.6 * Math.exp(-Math.pow((1 - s) / 0.13, 2))),
      sides: sidesBig - 2, segments: low ? 3 : 5,
      shape: (_s, phi) => 1 + 0.14 * Math.max(0, Math.cos(phi)),  // 背侧一道棱
      up: new THREE.Vector3(0, 0, 1),
      color: (s, _phi, _k, p) => boneColor(p, smooth(0.25, 0, Math.min(s, 1 - s)) * 0.5),
      start: 'flat', end: 'flat', rand,
    }));
  }

  // ── 头骨：侧躺，长吻；眼眶两个深窝，鼻孔一个暗口 ──
  const occiput = neck.getPointAt(1).add(new THREE.Vector3(-0.04, -0.03, 0.02));
  const skullDir = new THREE.Vector3(-0.96, -0.03, 0.2).normalize();
  // 背侧（头顶）朝外（+z），腹侧（下颌）朝身子
  const dorsal = new THREE.Vector3(-skullDir.z, 0, skullDir.x).normalize();
  if (dorsal.z < 0) dorsal.negate();
  // 头骨不是正侧躺：绕自身长轴滚 30°（下颌那边翘起来），朝天那只眼眶和张开的下颌都斜着露出来
  dorsal.applyAxisAngle(skullDir, -0.52);
  const skullLen = 0.6;
  const skullAt = (s: number) => occiput.clone().addScaledVector(skullDir, s * skullLen);
  // 楔形：颅后宽、到眼眶最宽（颧弓），往前一路收成长吻——不是灯泡 + 细棍
  const skullR = (s: number) => 0.04 + 0.06 * Math.exp(-Math.pow((s - 0.2) / 0.25, 2)) + 0.02 * (1 - s);
  const ORBIT_S = 0.33;
  const orbit = (s: number, phi: number) => Math.exp(-Math.pow((s - ORBIT_S) / 0.085, 2)) * smooth(0.45, 0.85, Math.abs(Math.sin(phi)));
  parts.push(tube({
    points: [0, 0.25, 0.5, 0.75, 1].map(skullAt),
    radius: skullR, sides: low ? 10 : 16, segments: low ? 10 : 18,
    // 截面背腹高、左右窄（侧躺 = 贴地扁）；眼眶往里凹；吻背一道浅棱
    shape: (s, phi) => (1 + 0.18 * Math.cos(2 * phi) + 0.06 * Math.cos(phi) * smooth(0.4, 0.9, s)) * (1 - 0.38 * orbit(s, phi)),
    up: dorsal,
    color: (s, phi, _k, p) => boneColor(p, 0.12 * s).lerp(BONE_DARK, smooth(0.2, 0.7, orbit(s, phi)) * 0.9),
    start: 'flat', end: 'flat', capColor: rim => (rim ? BONE_END : BONE_DARK).clone(), rand,
  }));
  // 眼眶骨环：朝天那一侧的一圈凸起（头骨最认得出的一笔）
  {
    const T = skullDir, B = new THREE.Vector3().crossVectors(T, dorsal).normalize();
    const up = B.y > 0 ? B : B.clone().negate();
    const center = skullAt(ORBIT_S).addScaledVector(up, skullR(ORBIT_S) * 0.86);
    const ringR = 0.055;
    const ring = Array.from({ length: 13 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      return center.clone().addScaledVector(T, Math.cos(a) * ringR * 1.15).addScaledVector(dorsal, Math.sin(a) * ringR);
    });
    parts.push(tube({
      points: ring, radius: () => 0.014, sides: 4, segments: low ? 10 : 16,
      color: (_s, _phi, _k, p) => boneColor(p),
      rand,
    }));
    // 眶里一块深色：贴着骨环下沿的扁椭球，平视也看得到黑洞
    const socketRot = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(T, up, new THREE.Vector3().crossVectors(T, up)));
    parts.push(ellipsoid(center.clone().addScaledVector(up, -0.012), [ringR * 1.05, 0.014, ringR * 0.9], socketRot, 10, 5, () => BONE_DARK.clone()));
  }
  // 颅后收圆（管子的平口在后脑勺上会显得被切了一刀）
  parts.push(ellipsoid(skullAt(0.03), [skullR(0.03) * 0.75, skullR(0.03) * 0.82, skullR(0.03) * 1.05],
    new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(skullDir, new THREE.Vector3().crossVectors(dorsal, skullDir).normalize(), dorsal)),
    low ? 8 : 12, low ? 5 : 8, (_d, q) => boneColor(q, 0.1)));
  // 下颌：一根扁骨从颅下贴着吻部往前，张开一点；后端一截上升支
  const ventral = dorsal.clone().negate();
  const jawOpen = ventral.clone().multiplyScalar(0.07);
  const jawA = skullAt(0.12).addScaledVector(ventral, 0.07), jawB = skullAt(0.93).addScaledVector(ventral, 0.035).add(jawOpen);
  parts.push(tube({
    points: [jawA, jawA.clone().lerp(jawB, 0.5).addScaledVector(ventral, 0.03), jawB],
    radius: s => 0.022 * (1 - 0.35 * s), sides: sidesSmall, segments: low ? 4 : 7,
    shape: (_s, phi) => 1 + 0.5 * Math.cos(2 * phi), up: dorsal,
    color: (_s, _phi, _k, p) => boneColor(p, 0.1),
    start: 'flat', end: 'flat', rand,
  }));
  parts.push(tube({
    points: [jawA, jawA.clone().addScaledVector(dorsal, 0.09).addScaledVector(skullDir, -0.02)],
    radius: () => 0.02, sides: 4, segments: 1,
    shape: (_s, phi) => 1 + 0.5 * Math.cos(2 * phi), up: skullDir,
    color: (_s, _phi, _k, p) => boneColor(p, 0.1),
    end: 'flat', rand,
  }));

  const boneGeo = mergeParts(parts);

  // ── 沙堆网格：极坐标环，每个顶点贴地 ──
  const rings = low ? 8 : 12, segs = low ? 28 : 40;
  const pos: number[] = [], col: number[] = [], uv: number[] = [], index: number[] = [];
  const sand = options.sand ? srgb(...options.sand) : SAND;
  const crest = sand.clone().lerp(new THREE.Color(1, 1, 1), 0.08);
  pos.push(-0.2, groundLocal(-0.2, -0.02) + moundH(-0.2, -0.02), -0.02);
  col.push(crest.r, crest.g, crest.b);
  uv.push(0.5, 0.5);
  for (let i = 1; i <= rings; i++) {
    const f = (i / rings) * 1.15;
    for (let j = 0; j < segs; j++) {
      const a = (j / segs) * Math.PI * 2;
      const lz = Math.sin(a) * f * (Math.sin(a) > 0 ? 0.78 : 0.9) - 0.02;
      const lx = Math.cos(a) * f * 1.7 - 0.2;
      pos.push(lx, groundLocal(lx, lz) + moundH(lx, lz), lz);
      const c = sand.clone().lerp(crest, smooth(0.8, 0.2, f));
      col.push(c.r, c.g, c.b);
      uv.push(0.5, 0.5);
    }
  }
  for (let j = 0; j < segs; j++) index.push(0, 1 + ((j + 1) % segs), 1 + j);
  for (let i = 1; i < rings; i++) for (let j = 0; j < segs; j++) {
    const a = 1 + (i - 1) * segs + j, b = 1 + (i - 1) * segs + ((j + 1) % segs);
    const c = a + segs, d = b + segs;
    index.push(a, b, c, b, d, c);
  }
  const moundGeo = new THREE.BufferGeometry();
  moundGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  moundGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  moundGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  moundGeo.setIndex(index);
  moundGeo.computeVertexNormals();

  const boneMat = proceduralLit('M_Proc_CamelBone', () => ({
    // 漂白骨头有一点点光泽；暗部别冷得发紫
    floats: { _Roughness: 0.72, _SpecStrength: 0.25, _RimStrength: 0.35 },
    colors: { _ShadowTint: [0.72, 0.7, 0.8, 1] },
  }), ctx.environment);
  const sandMat = sandMaterial(ctx);

  const group = new THREE.Group();
  group.name = 'CamelBones';
  group.position.copy(origin);
  group.quaternion.copy(rot);
  const bones = new THREE.Mesh(boneGeo, boneMat);
  bones.name = 'CamelBones_Skeleton';
  bones.castShadow = bones.receiveShadow = true;
  const mound = new THREE.Mesh(moundGeo, sandMat);
  mound.name = 'CamelBones_SandDrift';
  mound.receiveShadow = true;
  group.add(mound, bones);
  group.userData.triangles = { bones: triangles(boneGeo), mound: triangles(moundGeo) };

  // 碰撞：身子（肋拱 + 沙堆）一个矮盒，脖子和头一个更矮的盒
  const colliders: PieceBox[] = [
    yawBox(toWorld(new THREE.Vector3(-0.3, 0.33, -0.08)), [2.1, 0.7, 1.15], yaw, 'camelbones-body'),
    yawBox(toWorld(new THREE.Vector3(1.0, 0.15, 0.58)), [0.9, 0.3, 0.6], yaw, 'camelbones-neck'),
  ];
  return {
    object: group,
    colliders,
    dispose() {
      boneGeo.dispose();
      moundGeo.dispose();
    },
  };
}

// ───────────── 检视页 ─────────────

const LAB_AT: V2 = [0, 0];
const view = (name: string, eye: V3, look: V3, fov?: number) => ({ name, eye, look, fov });

/**
 * 检视页的地面是 Lambert（按 π 折算，比游戏里的风格化地形暗一截），沙堆接上去会显得发白。
 * 这里在骨架周围垫一块和沙堆同材质的沙地（= 游戏里地形的沙层色 + 同一套光照），看接缝是否融得进去。
 */
function withSandFloor(piece: BuiltPiece, ctx: PieceContext): BuiltPiece {
  const geo = new THREE.CircleGeometry(9, 48).rotateX(-Math.PI / 2);
  const n = geo.getAttribute('position').count;
  geo.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n }, () => [SAND.r, SAND.g, SAND.b]).flat(), 3));
  const floor = new THREE.Mesh(geo, sandMaterial(ctx));
  // 盖在检视页的 Lambert 地面上面一点（沙堆边沿压在它下面，和游戏里压进地形一样）
  floor.position.y = 0.004;
  floor.receiveShadow = true;
  const group = new THREE.Group();
  group.add(floor, piece.object);
  return { ...piece, object: group, dispose() { piece.dispose(); geo.dispose(); } };
}

export const LAB: LabPiece[] = [
  {
    id: 'camel-bones',
    title: '半埋驼骨',
    note: '1-1 古道边的近景叙事件：侧卧的骆驼骨架半埋在沙堆里，约 3 × 1.5 m、露出 0.8 m（白盒 [330, 234] 转 30°）。脚下垫一块同材质沙地（≈ 游戏地形）；远处摆商队残骸对色',
    build: ctx => labCombine(withSandFloor(buildCamelBones(LAB_AT, 0, 30, ctx), ctx), [
      labReference('SM_Tripo_DesertCaravanWreck', [-4.5, 0, -3], 60, 1, ctx),
    ]),
    views: [
      view('眼高', [1.6, 1.6, 4.2], [0, 0.3, 0]),
      view('蹲看头骨', [2.5, 0.75, 1.9], [1.0, 0.12, 0.3]),
      view('俯视', [0.6, 4.2, 2.6], [0, 0, 0]),
      view('中距', [6, 1.6, 9], [-1, 0.6, -1]),
    ],
  },
];
