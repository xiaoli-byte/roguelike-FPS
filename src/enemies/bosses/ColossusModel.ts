/**
 * 沙暴巨像的程序化低多边形模型（约 5.5 米高，朝 +Z，脚底在原点）。
 * 返回带关节引用的 rig，供 Colossus 做程序动画与受击判定。
 * 几何体 / 材质模板全部来自 parts 的模块级缓存。
 */
import * as THREE from 'three';
import { anchor, geo, glow, glowMesh, mesh, pivot, scaled, std } from './parts';

export interface ColossusRig {
  /** 整体（登场升起 / 死亡下沉用） */
  body: THREE.Group;
  hips: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  kneeL: THREE.Group; kneeR: THREE.Group;
  torso: THREE.Group;
  shoulderL: THREE.Group; shoulderR: THREE.Group;
  elbowL: THREE.Group; elbowR: THREE.Group;
  fistL: THREE.Object3D; fistR: THREE.Object3D;
  neck: THREE.Group;
  head: THREE.Group;
  eyeHalo: THREE.Mesh;
  coreHalo: THREE.Mesh;
  crown: THREE.Group;
  orbit: THREE.Group;
  chest: THREE.Object3D;
  belly: THREE.Object3D;
  upperArmL: THREE.Object3D; upperArmR: THREE.Object3D;
  footL: THREE.Object3D; footR: THREE.Object3D;
}

export const COLOSSUS_EYE = 0xffb347;
export const COLOSSUS_EYE_RAGE = 0xff3b1f;

const mats = () => ({
  sand: std(0xc89a5e, { rough: 0.92 }),
  sandDark: std(0x9a6d40, { rough: 0.95 }),
  stone: std(0x6f5a48, { rough: 0.95 }),
  gold: std(0xd4a53c, { rough: 0.38, metal: 0.7 }),
  cloth: std(0x8c2f22, { rough: 0.9 }),
  eye: glow(COLOSSUS_EYE),
  eyeHalo: glow(0xff9a30, 0.45, true),
  core: glow(0xffc860),
  coreHalo: glow(0xffa040, 0.35, true),
  rune: glow(0xffa83a),
});

function buildLeg(parent: THREE.Object3D, side: number, m: ReturnType<typeof mats>): { leg: THREE.Group; knee: THREE.Group; foot: THREE.Object3D } {
  const leg = pivot(parent, 0.75 * side, -0.05, 0);
  mesh(leg, geo.box(0.82, 1.15, 0.92), m.sand, 0, -0.55, 0);
  mesh(leg, geo.box(0.9, 0.18, 0.98), m.gold, 0, -0.08, 0);
  const knee = pivot(leg, 0, -1.1, 0);
  mesh(knee, geo.dodeca(0.4), m.stone, 0, 0, 0.16);
  mesh(knee, geo.cyl(0.42, 0.52, 0.95, 6), m.sand, 0, -0.5, 0);
  mesh(knee, geo.torus(0.5, 0.08, 5, 10), m.gold, 0, -0.78, 0, Math.PI / 2);
  const foot = mesh(knee, geo.box(1.0, 0.32, 1.35), m.sandDark, 0, -1.04, 0.2);
  for (let i = -1; i <= 1; i++) mesh(knee, geo.cone(0.13, 0.36, 4), m.stone, i * 0.32, -1.1, 0.98, Math.PI / 2);
  return { leg, knee, foot };
}

function buildArm(
  torso: THREE.Object3D, side: number, m: ReturnType<typeof mats>,
): { shoulder: THREE.Group; elbow: THREE.Group; fist: THREE.Object3D; upper: THREE.Object3D } {
  const shoulder = pivot(torso, 1.62 * side, 1.45, 0);
  scaled(mesh(shoulder, geo.dodeca(0.72), m.sandDark, 0.12 * side, 0.22, 0), 1.15, 0.85, 1.05);
  mesh(shoulder, geo.octa(0.2), m.gold, 0.55 * side, 0.4, 0);
  mesh(shoulder, geo.cone(0.16, 0.6, 5), m.stone, 0.3 * side, 0.78, -0.1, 0, 0, -0.35 * side);
  mesh(shoulder, geo.box(0.62, 1.15, 0.68), m.sand, 0, -0.62, 0);
  glowMesh(shoulder, geo.box(0.08, 0.7, 0.06), m.rune, 0.18 * side, -0.62, 0.35, 'rune');
  const upper = anchor(shoulder, 0, -0.62, 0);
  const elbow = pivot(shoulder, 0, -1.22, 0);
  mesh(elbow, geo.dodeca(0.36), m.stone, 0, 0, 0);
  mesh(elbow, geo.cyl(0.4, 0.52, 1.05, 6), m.sand, 0, -0.55, 0);
  mesh(elbow, geo.torus(0.5, 0.1, 5, 12), m.gold, 0, -0.78, 0, Math.PI / 2);
  const fist = mesh(elbow, geo.dodeca(0.62), m.stone, 0, -1.35, 0.05);
  mesh(elbow, geo.box(0.9, 0.2, 0.25), m.gold, 0, -1.05, 0.25);
  return { shoulder, elbow, fist, upper };
}

export function buildColossus(): { root: THREE.Group; rig: ColossusRig } {
  const m = mats();
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);

  // ── 髋部与双腿 ──
  const hips = pivot(body, 0, 2.35, 0);
  mesh(hips, geo.box(2.1, 0.7, 1.25), m.sandDark, 0, 0, 0);
  mesh(hips, geo.box(2.2, 0.16, 1.32), m.gold, 0, 0.3, 0);
  mesh(hips, geo.box(0.95, 1.0, 0.1), m.cloth, 0, -0.7, 0.64, -0.08);
  mesh(hips, geo.box(0.95, 1.0, 0.1), m.cloth, 0, -0.7, -0.64, 0.08);
  glowMesh(hips, geo.box(0.5, 0.08, 0.05), m.rune, 0, -0.35, 0.7, 'rune');
  const L = buildLeg(hips, -1, m);
  const R = buildLeg(hips, 1, m);
  const belly = anchor(hips, 0, 0.05, 0);

  // ── 躯干 ──
  const torso = pivot(body, 0, 2.75, 0);
  mesh(torso, geo.cyl(0.95, 0.8, 0.7, 7), m.sand, 0, 0.3, 0);
  mesh(torso, geo.cyl(1.4, 1.0, 1.05, 7), m.sand, 0, 1.12, 0);
  mesh(torso, geo.box(1.6, 0.85, 0.3), m.sandDark, 0, 1.12, 0.9, -0.12);
  mesh(torso, geo.box(2.5, 0.3, 1.1), m.gold, 0, 1.62, 0);
  // 胸口核心
  glowMesh(torso, geo.ico(0.34, 0), m.core, 0, 1.08, 1.1, 'core');
  mesh(torso, geo.torus(0.46, 0.09, 6, 14), m.gold, 0, 1.08, 1.06);
  const coreHalo = glowMesh(torso, geo.sphere(0.72, 10, 8), m.coreHalo, 0, 1.08, 1.12, 'coreHalo');
  // 符文
  glowMesh(torso, geo.box(0.1, 0.75, 0.06), m.rune, -0.72, 1.12, 1.03, 'rune');
  glowMesh(torso, geo.box(0.1, 0.75, 0.06), m.rune, 0.72, 1.12, 1.03, 'rune');
  glowMesh(torso, geo.box(0.7, 0.08, 0.06), m.rune, 0, 0.45, 0.92, 'rune');
  // 背后石碑与脊石
  mesh(torso, geo.box(1.9, 1.7, 0.55), m.sand, 0, 1.2, -0.88, 0.12);
  glowMesh(torso, geo.box(0.12, 1.2, 0.05), m.rune, 0, 1.25, -1.17, 'rune');
  mesh(torso, geo.dodeca(0.36), m.stone, 0, 2.05, -1.02);
  mesh(torso, geo.dodeca(0.3), m.stone, 0.55, 1.9, -1.0);
  mesh(torso, geo.dodeca(0.3), m.stone, -0.55, 1.9, -1.0);
  // 胸部判定锚点（配合 Colossus 里半径 1.05、半高 0.2 的胶囊，顶点约在 4.75 米）：
  // 低于头部（弱点，中心约 4.9 米）的中下部，平视或俯视瞄准独眼都能判为爆头；瞄准颈部以下判为身体
  const chest = anchor(torso, 0, 0.75, 0.15);

  // ── 双臂 ──
  const AL = buildArm(torso, -1, m);
  const AR = buildArm(torso, 1, m);

  // ── 头颈 ──
  const neck = pivot(torso, 0, 1.72, 0.1);
  mesh(neck, geo.cyl(0.38, 0.48, 0.4, 6), m.stone, 0, 0.05, 0);
  const head = pivot(neck, 0, 0.42, 0.05);
  mesh(head, geo.box(0.95, 0.8, 0.9), m.sand, 0, 0, 0);
  mesh(head, geo.box(0.25, 0.32, 0.92), m.sandDark, 0, 0.52, -0.04);
  mesh(head, geo.box(1.05, 0.18, 0.3), m.sandDark, 0, 0.2, 0.4);
  mesh(head, geo.box(0.75, 0.28, 0.65), m.stone, 0, -0.42, 0.12);
  mesh(head, geo.box(1.0, 0.1, 0.95), m.gold, 0, 0.34, 0);
  glowMesh(head, geo.box(0.62, 0.11, 0.08), m.eye, 0, 0.04, 0.46, 'eye');
  glowMesh(head, geo.sphere(0.15, 8, 6), m.eye, 0, 0.04, 0.49, 'eye');
  const eyeHalo = glowMesh(head, geo.sphere(0.42, 10, 8), m.eyeHalo, 0, 0.04, 0.52, 'eyeHalo');
  mesh(head, geo.cone(0.13, 0.75, 5), m.sandDark, -0.5, 0.45, -0.05, 0, 0, 0.55);
  mesh(head, geo.cone(0.13, 0.75, 5), m.sandDark, 0.5, 0.45, -0.05, 0, 0, -0.55);
  // 悬浮冠石
  const crown = pivot(head, 0, 0.95, 0);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    glowMesh(crown, geo.octa(0.13), m.rune, Math.sin(a) * 0.55, 0, Math.cos(a) * 0.55, 'rune');
  }

  // ── 环绕浮石 ──
  const orbit = pivot(body, 0, 3.3, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const r = 2.7 + (i % 2) * 0.35;
    const s = mesh(orbit, geo.dodeca(0.28 + (i % 3) * 0.06), m.stone, Math.sin(a) * r, (i % 3) * 0.45 - 0.4, Math.cos(a) * r);
    s.rotation.set(i, i * 2, 0);
    glowMesh(orbit, geo.box(0.05, 0.25, 0.05), m.rune, Math.sin(a) * r, (i % 3) * 0.45 - 0.05, Math.cos(a) * r, 'rune');
  }

  return {
    root,
    rig: {
      body, hips,
      legL: L.leg, legR: R.leg, kneeL: L.knee, kneeR: R.knee,
      torso,
      shoulderL: AL.shoulder, shoulderR: AR.shoulder,
      elbowL: AL.elbow, elbowR: AR.elbow,
      fistL: AL.fist, fistR: AR.fist,
      neck, head, eyeHalo, coreHalo, crown, orbit, chest, belly,
      upperArmL: AL.upper, upperArmR: AR.upper,
      footL: L.foot, footR: R.foot,
    },
  };
}
