/**
 * 霜翼妖后的程序化低多边形模型（约 3.5 米高，朝 +Z，脚底 = 冰尾尖端）。
 * 飘浮的幽灵式冰尾、蓝袍银甲、冰晶王冠（弱点）与两扇四羽冰翼。
 */
import * as THREE from 'three';
import { anchor, geo, glow, glowMesh, mesh, pivot, scaled, std } from './parts';

export interface MatriarchRig {
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  armL: THREE.Group; armR: THREE.Group;
  foreL: THREE.Group; foreR: THREE.Group;
  handL: THREE.Object3D; handR: THREE.Object3D;
  wings: THREE.Group;
  wingL: THREE.Group; wingR: THREE.Group;
  wingAnchorL: THREE.Object3D; wingAnchorR: THREE.Object3D;
  orbit: THREE.Group;
  chest: THREE.Object3D;
  skirt: THREE.Object3D;
  tail: THREE.Object3D;
  core: THREE.Object3D;
  coreHalo: THREE.Mesh;
  crownHalo: THREE.Mesh;
  /** 弱点（头部 + 冰冠）判定锚点 */
  weak: THREE.Object3D;
}

export const FROST = 0x7fe8ff;
export const FROST_RAGE = 0xa98bff;

const mats = () => ({
  ice: std(0xbfefff, { emissive: 0x3aa8ff, ei: 0.35, rough: 0.25, metal: 0.1 }),
  wing: std(0xa6e6ff, { emissive: 0x3a9cff, ei: 0.45, rough: 0.2, metal: 0.1, opacity: 0.82 }),
  robe: std(0x2b3f8c, { rough: 0.7 }),
  robeDark: std(0x1b2556, { rough: 0.75 }),
  silver: std(0xc9dcff, { rough: 0.3, metal: 0.75 }),
  skin: std(0xe4f4ff, { rough: 0.5 }),
  core: glow(0x9ff0ff),
  coreHalo: glow(0x5ad0ff, 0.35, true),
  eye: glow(0xd8fbff),
  gem: glow(0x7fe8ff),
  crownHalo: glow(0x6fdcff, 0.3, true),
  wingGlow: glow(FROST),
  shard: glow(0xbff4ff, 0.9),
});

type Mats = ReturnType<typeof mats>;

function buildArm(torso: THREE.Object3D, side: number, m: Mats): { arm: THREE.Group; fore: THREE.Group; hand: THREE.Object3D } {
  const arm = pivot(torso, 0.5 * side, 0.88, 0);
  mesh(arm, geo.cyl(0.085, 0.07, 0.6, 6), m.skin, 0, -0.3, 0);
  const fore = pivot(arm, 0, -0.6, 0);
  mesh(fore, geo.cyl(0.07, 0.055, 0.55, 6), m.skin, 0, -0.27, 0);
  mesh(fore, geo.cyl(0.1, 0.09, 0.22, 6), m.silver, 0, -0.15, 0);
  mesh(fore, geo.octa(0.1), m.skin, 0, -0.6, 0);
  for (let i = -1; i <= 1; i++) mesh(fore, geo.cone(0.025, 0.22, 3), m.ice, i * 0.05, -0.76, 0.02, Math.PI);
  const hand = anchor(fore, 0, -0.62, 0.05);
  return { arm, fore, hand };
}

const FEATHERS = [
  { len: 2.5, ang: -0.45, w: 0.3 },
  { len: 2.1, ang: -0.1, w: 0.26 },
  { len: 1.7, ang: 0.25, w: 0.22 },
  { len: 1.2, ang: 0.55, w: 0.18 },
];

function buildWing(parent: THREE.Object3D, side: number, m: Mats): { wing: THREE.Group; tip: THREE.Object3D } {
  const wing = pivot(parent, 0.12 * side, 0, 0);
  for (const f of FEATHERS) {
    const fp = pivot(wing, 0, 0, 0);
    fp.rotation.z = -f.ang * side;
    scaled(mesh(fp, geo.octa(1), m.wing, (f.len / 2) * side, 0, 0), f.len / 2, 0.045, f.w);
    glowMesh(fp, geo.box(f.len * 0.85, 0.02, 0.03), m.wingGlow, (f.len / 2) * side, 0.035, 0, 'wingGlow');
  }
  const tip = anchor(wing, 1.1 * side, 0.1, 0);
  return { wing, tip };
}

export function buildMatriarch(): { root: THREE.Group; rig: MatriarchRig } {
  const m = mats();
  const root = new THREE.Group();
  const body = pivot(root, 0, 0, 0);

  // ── 冰尾与裙摆 ──
  mesh(body, geo.cone(0.32, 1.0, 6), m.ice, 0, 0.5, 0, Math.PI);
  mesh(body, geo.cone(0.9, 1.35, 8), m.robe, 0, 1.0, 0, Math.PI);
  mesh(body, geo.torus(0.78, 0.05, 4, 16), m.silver, 0, 1.62, 0, Math.PI / 2);
  for (let i = 0; i < 8; i++) {
    const g = pivot(body, 0, 1.45, 0);
    g.rotation.y = (i / 8) * Math.PI * 2;
    mesh(g, geo.cone(0.1, 1.0, 4), m.ice, 0, -0.35, 0.62, Math.PI - 0.35);
  }
  const skirt = anchor(body, 0, 1.15, 0);
  const tail = anchor(body, 0, 0.45, 0);

  // ── 躯干 ──
  const torso = pivot(body, 0, 1.7, 0);
  mesh(torso, geo.torus(0.33, 0.06, 5, 14), m.silver, 0, 0.02, 0, Math.PI / 2);
  mesh(torso, geo.cyl(0.3, 0.26, 0.42, 7), m.robe, 0, 0.2, 0);
  mesh(torso, geo.cyl(0.46, 0.3, 0.62, 7), m.robe, 0, 0.68, 0);
  scaled(mesh(torso, geo.octa(0.36), m.silver, 0, 0.7, 0.2), 1.25, 1.0, 0.45);
  const core = glowMesh(torso, geo.octa(0.15), m.core, 0, 0.68, 0.39, 'core');
  const coreHalo = glowMesh(torso, geo.sphere(0.34, 10, 8), m.coreHalo, 0, 0.68, 0.42, 'coreHalo');
  for (const s of [-1, 1]) {
    mesh(torso, geo.cone(0.06, 0.5, 4), m.ice, 0.32 * s, 1.1, -0.05, 0, 0, -0.35 * s);
    mesh(torso, geo.cone(0.05, 0.4, 4), m.ice, 0.16 * s, 1.15, -0.12, 0, 0, -0.15 * s);
    mesh(torso, geo.sphere(0.17, 8, 6), m.silver, 0.48 * s, 0.9, 0);
  }
  // 胸部判定锚点（配合 Matriarch 里半径 0.45、半高 0.15 的胶囊，顶点约在躯干 1.05 处 = 衣领）
  const chest = anchor(torso, 0, 0.45, 0);
  const AL = buildArm(torso, -1, m);
  const AR = buildArm(torso, 1, m);

  // ── 头部与冰冠 ──
  mesh(torso, geo.cyl(0.08, 0.11, 0.26, 6), m.skin, 0, 1.02, 0);
  const head = pivot(torso, 0, 1.24, 0.02);
  scaled(mesh(head, geo.sphere(0.25, 8, 6), m.skin, 0, 0, 0), 0.85, 1.1, 0.9);
  scaled(mesh(head, geo.octa(0.2), m.silver, 0, 0.04, 0.16), 1.35, 0.5, 0.55);
  glowMesh(head, geo.sphere(0.045, 6, 4), m.eye, -0.085, 0.045, 0.265, 'eye');
  glowMesh(head, geo.sphere(0.045, 6, 4), m.eye, 0.085, 0.045, 0.265, 'eye');
  const crown = pivot(head, 0, 0.2, -0.03);
  const spikes = [-0.55, -0.28, 0, 0.28, 0.55];
  const heights = [0.32, 0.42, 0.55, 0.42, 0.32];
  for (let i = 0; i < spikes.length; i++) {
    const g = pivot(crown, 0, 0, 0);
    g.rotation.z = -spikes[i];
    mesh(g, geo.cone(0.05, heights[i], 4), m.ice, 0, heights[i] / 2 + 0.05, 0);
  }
  glowMesh(head, geo.octa(0.08), m.gem, 0, 0.3, 0.18, 'gem');
  const crownHalo = glowMesh(head, geo.sphere(0.34, 10, 8), m.crownHalo, 0, 0.2, 0.05, 'crownHalo');
  mesh(head, geo.cone(0.3, 1.2, 6), m.robeDark, 0, -0.35, -0.2, -0.3);
  // 弱点判定中心：头部与冰冠之间（玩家总在下方仰射，球心略上移让冰冠也算弱点）
  const weak = anchor(head, 0, 0.15, 0);

  // ── 冰翼 ──
  const wings = pivot(torso, 0, 0.78, -0.3);
  const WL = buildWing(wings, -1, m);
  const WR = buildWing(wings, 1, m);

  // ── 环绕冰棱 ──
  const orbit = pivot(body, 0, 1.6, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const s = glowMesh(orbit, geo.octa(0.12), m.shard, Math.sin(a) * 1.35, i % 2 ? 0.25 : -0.25, Math.cos(a) * 1.35, 'shard');
    s.scale.set(0.6, 1.8, 0.6);
  }

  return {
    root,
    rig: {
      body, torso, head,
      armL: AL.arm, armR: AR.arm, foreL: AL.fore, foreR: AR.fore, handL: AL.hand, handR: AR.hand,
      wings, wingL: WL.wing, wingR: WR.wing, wingAnchorL: WL.tip, wingAnchorR: WR.tip,
      orbit, chest, skirt, tail, core, coreHalo, crownHalo, weak,
    },
  };
}
