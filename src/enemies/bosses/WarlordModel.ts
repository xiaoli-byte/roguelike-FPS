/**
 * 熔心魔将的程序化低多边形模型（约 3.7 米高，朝 +Z，脚底在原点）。
 * 玄铁重甲、熔岩裂纹、胸口熔心、角盔（弱点）、披风与右手焰刃（持剑手在 -X，即模型自身的右侧）。
 */
import * as THREE from 'three';
import { anchor, geo, glow, glowMesh, mesh, pivot, scaled, std } from './parts';

export interface WarlordRig {
  body: THREE.Group;
  hips: THREE.Group;
  legL: THREE.Group; legR: THREE.Group;
  kneeL: THREE.Group; kneeR: THREE.Group;
  torso: THREE.Group;
  /** 持剑臂（-X） */
  armS: THREE.Group; elbowS: THREE.Group;
  /** 空手臂（+X） */
  armO: THREE.Group; elbowO: THREE.Group;
  sword: THREE.Group;
  bladeBase: THREE.Object3D; bladeTip: THREE.Object3D;
  cape: THREE.Group;
  head: THREE.Group;
  crest: THREE.Mesh;
  coreHalo: THREE.Mesh;
  chest: THREE.Object3D;
  pauldronL: THREE.Object3D; pauldronR: THREE.Object3D;
}

export const EMBER = 0xff7a2a;
export const EMBER_RAGE = 0xff3a10;
export const EMBER_FURY = 0xffd070;

const mats = () => ({
  iron: std(0x3a3438, { rough: 0.55, metal: 0.6 }),
  ironDark: std(0x241f22, { rough: 0.6, metal: 0.5 }),
  gold: std(0x9c6b2a, { rough: 0.4, metal: 0.7 }),
  bone: std(0x2a1f1a, { rough: 0.8 }),
  cloth: std(0x7a1414, { rough: 0.9 }),
  blade: std(0x2a2226, { rough: 0.35, metal: 0.8, emissive: 0x3a0a00, ei: 1 }),
  ember: glow(EMBER),
  core: glow(0xffb45a),
  coreHalo: glow(0xff5a1a, 0.4, true),
  eye: glow(0xffc070),
  eyeHalo: glow(0xff7a2a, 0.35, true),
  flame: glow(0xff6a1a, 0.7, true),
  bladeHalo: glow(0xff4a12, 0.28, true),
});

type Mats = ReturnType<typeof mats>;

function buildLeg(hips: THREE.Object3D, side: number, m: Mats): { leg: THREE.Group; knee: THREE.Group } {
  const leg = pivot(hips, 0.3 * side, -0.1, 0);
  mesh(leg, geo.box(0.36, 0.72, 0.42), m.ironDark, 0, -0.36, 0);
  const knee = pivot(leg, 0, -0.74, 0);
  mesh(knee, geo.cone(0.15, 0.4, 5), m.iron, 0, 0.02, 0.2, Math.PI / 2);
  mesh(knee, geo.cyl(0.19, 0.24, 0.66, 6), m.iron, 0, -0.34, 0);
  glowMesh(knee, geo.box(0.03, 0.5, 0.02), m.ember, 0.1 * side, -0.34, 0.22, 'ember');
  mesh(knee, geo.box(0.34, 0.16, 0.6), m.ironDark, 0, -0.7, 0.1);
  return { leg, knee };
}

function buildArm(torso: THREE.Object3D, side: number, m: Mats): { arm: THREE.Group; elbow: THREE.Group } {
  const arm = pivot(torso, 0.86 * side, 0.88, 0);
  mesh(arm, geo.box(0.3, 0.68, 0.32), m.ironDark, 0, -0.34, 0);
  const elbow = pivot(arm, 0, -0.7, 0);
  mesh(elbow, geo.dodeca(0.17), m.iron, 0, 0, 0);
  mesh(elbow, geo.cyl(0.16, 0.2, 0.6, 6), m.iron, 0, -0.3, 0);
  mesh(elbow, geo.box(0.28, 0.26, 0.3), m.ironDark, 0, -0.68, 0);
  mesh(elbow, geo.cone(0.05, 0.22, 4), m.gold, 0.15 * side, -0.25, 0, 0, 0, -Math.PI / 2 * side);
  glowMesh(elbow, geo.box(0.03, 0.4, 0.02), m.ember, 0, -0.3, 0.19, 'ember');
  return { arm, elbow };
}

function buildSword(hand: THREE.Object3D, m: Mats): { sword: THREE.Group; base: THREE.Object3D; tip: THREE.Object3D } {
  const sword = pivot(hand, 0, -0.72, 0.06);
  mesh(sword, geo.cyl(0.045, 0.045, 0.45, 6), m.bone, 0, 0.02, 0);
  mesh(sword, geo.dodeca(0.075), m.gold, 0, 0.28, 0);
  mesh(sword, geo.box(0.62, 0.1, 0.16), m.iron, 0, -0.24, 0);
  mesh(sword, geo.cone(0.05, 0.25, 4), m.gold, 0.36, -0.24, 0, 0, 0, -Math.PI / 2);
  mesh(sword, geo.cone(0.05, 0.25, 4), m.gold, -0.36, -0.24, 0, 0, 0, Math.PI / 2);
  mesh(sword, geo.box(0.2, 2.3, 0.06), m.blade, 0, -1.45, 0);
  glowMesh(sword, geo.box(0.04, 2.2, 0.08), m.ember, 0.11, -1.45, 0, 'blade');
  glowMesh(sword, geo.box(0.04, 2.2, 0.08), m.ember, -0.11, -1.45, 0, 'blade');
  mesh(sword, geo.cone(0.1, 0.35, 4), m.blade, 0, -2.77, 0, Math.PI);
  glowMesh(sword, geo.box(0.36, 2.35, 0.14), m.bladeHalo, 0, -1.45, 0, 'bladeHalo');
  const base = anchor(sword, 0, -0.35, 0);
  const tip = anchor(sword, 0, -2.7, 0);
  return { sword, base, tip };
}

export function buildWarlord(): { root: THREE.Group; rig: WarlordRig } {
  const m = mats();
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);

  // ── 髋部、裙甲与双腿 ──
  const hips = pivot(body, 0, 1.62, 0);
  mesh(hips, geo.box(0.95, 0.42, 0.62), m.ironDark, 0, 0, 0);
  mesh(hips, geo.box(1.0, 0.14, 0.68), m.gold, 0, 0.2, 0);
  glowMesh(hips, geo.dodeca(0.12), m.ember, 0, 0.2, 0.36, 'ember');
  for (const s of [-1, 1]) {
    mesh(hips, geo.box(0.4, 0.7, 0.07), m.iron, 0.26 * s, -0.38, 0.34, -0.18);
    mesh(hips, geo.box(0.4, 0.7, 0.07), m.iron, 0.26 * s, -0.38, -0.34, 0.18);
    mesh(hips, geo.box(0.07, 0.62, 0.45), m.iron, 0.52 * s, -0.33, 0, 0, 0, 0.2 * s);
    glowMesh(hips, geo.box(0.03, 0.55, 0.02), m.ember, 0.26 * s, -0.4, 0.39, 'ember');
  }
  const L = buildLeg(hips, -1, m);
  const R = buildLeg(hips, 1, m);

  // ── 躯干 ──
  const torso = pivot(body, 0, 1.9, 0);
  mesh(torso, geo.cyl(0.5, 0.42, 0.5, 7), m.ironDark, 0, 0.2, 0);
  mesh(torso, geo.cyl(0.75, 0.52, 0.8, 6), m.iron, 0, 0.72, 0);
  mesh(torso, geo.box(0.95, 0.62, 0.26), m.iron, 0, 0.75, 0.4, -0.12);
  glowMesh(torso, geo.octa(0.2), m.core, 0, 0.72, 0.56, 'core');
  const coreHalo = glowMesh(torso, geo.sphere(0.45, 10, 8), m.coreHalo, 0, 0.72, 0.6, 'coreHalo');
  for (const a of [-0.6, 0.6, 2.4, -2.4]) {
    const c = glowMesh(torso, geo.box(0.035, 0.36, 0.02), m.ember, Math.sin(a) * 0.2, 0.72 + Math.cos(a) * 0.2, 0.55, 'ember');
    c.rotation.z = -a;
  }
  // 肩甲
  const pauldrons: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    scaled(mesh(torso, geo.dodeca(0.42), m.iron, 0.84 * s, 1.02, 0), 1.25, 0.85, 1.1);
    mesh(torso, geo.cone(0.09, 0.5, 5), m.bone, 0.98 * s, 1.38, 0, 0, 0, -0.4 * s);
    mesh(torso, geo.cone(0.07, 0.4, 5), m.bone, 0.72 * s, 1.36, -0.22, -0.3, 0, -0.15 * s);
    glowMesh(torso, geo.box(0.5, 0.035, 0.035), m.ember, 0.84 * s, 0.84, 0.32, 'ember');
    pauldrons.push(anchor(torso, 0.84 * s, 1.02, 0));
  }
  // 胸部判定锚点压低，保证正面射击时头盔（弱点）不被胸部胶囊遮挡
  const chest = anchor(torso, 0, 0.6, 0.05);
  // 披风
  const cape = pivot(torso, 0, 1.05, -0.42);
  mesh(cape, geo.box(1.25, 2.0, 0.05), m.cloth, 0, -1.0, -0.02);
  mesh(cape, geo.sphere(0.08, 6, 4), m.gold, -0.5, 0, 0.05);
  mesh(cape, geo.sphere(0.08, 6, 4), m.gold, 0.5, 0, 0.05);

  // ── 双臂与焰刃 ──
  const AS = buildArm(torso, -1, m);
  const AO = buildArm(torso, 1, m);
  const S = buildSword(AS.elbow, m);

  // ── 角盔 ──
  mesh(torso, geo.cyl(0.16, 0.2, 0.25, 6), m.ironDark, 0, 1.08, 0);
  const head = pivot(torso, 0, 1.28, 0.03);
  mesh(head, geo.cyl(0.27, 0.31, 0.5, 6), m.iron, 0, 0, 0);
  mesh(head, geo.cone(0.28, 0.25, 6), m.iron, 0, 0.37, 0);
  mesh(head, geo.box(0.44, 0.34, 0.12), m.ironDark, 0, -0.06, 0.25);
  glowMesh(head, geo.box(0.32, 0.06, 0.04), m.eye, 0, 0.03, 0.32, 'eye');
  glowMesh(head, geo.sphere(0.3, 10, 8), m.eyeHalo, 0, 0.03, 0.33, 'eyeHalo');
  for (const s of [-1, 1]) {
    const h1 = pivot(head, 0.26 * s, 0.22, -0.02);
    h1.rotation.z = -0.95 * s;
    mesh(h1, geo.cone(0.1, 0.55, 5), m.bone, 0, 0.27, 0);
    const h2 = pivot(h1, 0, 0.5, 0);
    h2.rotation.z = 0.75 * s;
    mesh(h2, geo.cone(0.07, 0.45, 5), m.bone, 0, 0.22, 0);
  }
  const crest = glowMesh(head, geo.cone(0.12, 0.55, 5), m.flame, 0, 0.62, -0.05, 'flame');

  return {
    root,
    rig: {
      body, hips,
      legL: L.leg, legR: R.leg, kneeL: L.knee, kneeR: R.knee,
      torso,
      armS: AS.arm, elbowS: AS.elbow, armO: AO.arm, elbowO: AO.elbow,
      sword: S.sword, bladeBase: S.base, bladeTip: S.tip,
      cape, head, crest, coreHalo, chest,
      pauldronL: pauldrons[0], pauldronR: pauldrons[1],
    },
  };
}
