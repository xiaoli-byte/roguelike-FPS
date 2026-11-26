import type { PieceRequest } from '../redo/compile';
import { Kit, PAL, bracket, lattice, loadPropGlb, pentRoof, post, roof, shade, type RoofOpts } from './timber';
import type { BuiltPiece, LabPiece, PieceContext, V3 } from './types';

/**
 * 坐像殿（1-3 寺院前庭北面）：罩住已有敦煌坐像（另摆：坐像中心 (210, 169)，台基 x 203.3–216.7、z 163–175 高 1.72，像顶 13.72）的木构大殿。
 *   平面 x 201.5–218、z 159–176：后墙（z 159–159.8）、两山墙（x 201.5–202.3 / 217.2–218）实心到檐下；正面（南）敞开，
 *   四根檐柱 r 0.45 在 z 175.5、x {202, 206.2, 213.3, 217.6}，阑额底 15.0——前庭 (212, 208) 眼高看像顶的视线过正面约 11.5 m，15 m 以下什么都不挡。
 *   歇山顶出檐 2 m（x 199.5–220、z 157–178），檐口 16（四角起翘到约 16.9）、脊约 21；两山和后檐一道腰檐（檐口 10.5、贴墙 12）成重檐。
 *   腰檐压在 10.5 以上：1-3 ② 越过中坊望寺塔的视线在 z 157–165 贴着东山墙外 x ≈ 219.1–219.9 走，高 8–9.6 m，不能挡。
 *   正面次间各挂一面幡（update 里飘），明间额上一块匾；殿里留空给台基和坐像。
 */

export const STATUE_COLS = [202, 206.2, 213.3, 217.6];
const H = { x0: 201.5, x1: 218, z0: 159, z1: 176 };
const FRONT_Z = 175.5, COL_R = 0.45, ARCH_UNDER = 15.0;
const MAIN_ROOF: RoofOpts = {
  x: 209.75, z: 167.5, kind: 'xieshan', hx: 10.25, hz: 10.5, eave: 16.0, ridge: 20.1,
  gableX: 5.0, lift: 0.95, flare: 0.65, rafterOut: 2.2, rafterStep: 0.42, curve: 0.5,
};

export function buildStatueHall(ctx: PieceContext): BuiltPiece {
  const kit = new Kit(ctx, '坐像殿');
  const top = 0.15;

  // ── 台明（殿内铺地，和前庭齐平，边 0.15）──
  kit.box([(H.x0 + H.x1) / 2, top - 0.3, (H.z0 + 176.4) / 2], [H.x1 - H.x0 + 0.2, 0.6, 176.4 - H.z0], PAL.stone, 'stone', { skipBottom: true, uv: 0.5 });
  kit.collide([(H.x0 + H.x1) / 2, top - 0.3, (H.z0 + 176.4) / 2], [H.x1 - H.x0 + 0.2, 0.6, 176.4 - H.z0], '坐像殿 台明');

  // ── 后墙、两山墙：石下碱 + 土红墙身 + 赭白上段，墙里露木骨（壁柱、额枋）──
  const wallTop = 15.5;
  const wall = (c: V3, s: V3, name: string, alongX: boolean): void => {
    const [cx, , cz] = c;
    kit.box([cx, 0.65, cz], [s[0] + 0.08, 1.3, s[2] + 0.08], PAL.stoneDark, 'stone', { skipBottom: true });
    kit.box([cx, (1.3 + 10.3) / 2, cz], [s[0], 10.3 - 1.3, s[2]], PAL.plasterRed, 'plaster');
    kit.box([cx, (10.3 + wallTop) / 2, cz], [s[0] - 0.02, wallTop - 10.3, s[2] - 0.02], PAL.plaster, 'plaster');
    // 腰枋、额枋（贴着墙面凸出一点）
    for (const y of [10.3, 14.85]) kit.box([cx, y, cz], [s[0] + (alongX ? 0 : 0.14), 0.4, s[2] + (alongX ? 0.14 : 0)], PAL.beamRed);
    kit.box([cx, 1.32, cz], [s[0] + (alongX ? 0 : 0.12), 0.12, s[2] + (alongX ? 0.12 : 0)], PAL.beam);
    kit.collide([cx, wallTop / 2, cz], [s[0], wallTop + 0.4, s[2]], name);
  };
  wall([(H.x0 + H.x1) / 2, 0, 159.4], [H.x1 - H.x0, 0, 0.8], '坐像殿 后墙', true);
  wall([201.9, 0, (159.8 + 175.1) / 2], [0.8, 0, 175.1 - 159.8], '坐像殿 西山墙', false);
  wall([217.6, 0, (159.8 + 175.1) / 2], [0.8, 0, 175.1 - 159.8], '坐像殿 东山墙', false);
  // 壁柱（墙里露出半根）
  for (const z of [159.4, 163.4, 167.4, 171.4]) {
    for (const x of [201.45, 218.05]) kit.box([x, (1.3 + wallTop) / 2, z], [0.22, wallTop - 1.3, 0.5], PAL.lacquer);
  }
  for (const x of [206.2, 210.0, 213.3]) kit.box([x, (1.3 + wallTop) / 2, 158.95], [0.5, wallTop - 1.3, 0.22], PAL.lacquer);
  // 殿内壁画：深土红下段、青绿腰带、暗赭上段排一墙千佛（低对比，只给节奏，不抢坐像）
  const inner: { a: [number, number]; b: [number, number]; n: [number, number] }[] = [
    { a: [202.3, 159.8], b: [217.2, 159.8], n: [0, 1] },
    { a: [202.3, 175.1], b: [202.3, 159.8], n: [1, 0] },
    { a: [217.2, 159.8], b: [217.2, 175.1], n: [-1, 0] },
  ];
  const mural = { low: [0.34, 0.17, 0.12] as const, band: shade(PAL.teal, 0.7), high: [0.44, 0.34, 0.24] as const };
  for (const w of inner) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    const ux = (w.b[0] - w.a[0]) / len, uz = (w.b[1] - w.a[1]) / len;
    const at = (t: number, y: number, off: number): V3 => [w.a[0] + ux * t + w.n[0] * off, y, w.a[1] + uz * t + w.n[1] * off];
    const yaw = (Math.atan2(-uz, ux) * 180) / Math.PI;
    kit.boxYaw(at(len / 2, (1.3 + 9.7) / 2, 0.02), [len, 9.7 - 1.3, 0.04], yaw, mural.low, 'plaster');
    kit.boxYaw(at(len / 2, 10.0, 0.03), [len, 0.6, 0.05], yaw, mural.band, 'plaster');
    kit.boxYaw(at(len / 2, (10.3 + 15.5) / 2, 0.02), [len, 15.5 - 10.3, 0.04], yaw, mural.high, 'plaster');
    for (let r = 0; r < 5; r++) {
      for (let t = 0.55; t < len - 0.3; t += 0.72) {
        const k = (r + Math.round(t / 0.72)) % 3;
        const col = k === 0 ? [0.5, 0.4, 0.29] as const : k === 1 ? shade(PAL.teal, 0.62) : [0.46, 0.27, 0.2] as const;
        kit.boxYaw(at(t, 10.95 + r * 0.88, 0.05), [0.34, 0.5, 0.02], yaw, col, 'plaster');
        kit.boxYaw(at(t, 11.28 + r * 0.88, 0.05), [0.2, 0.18, 0.02], yaw, [0.55, 0.46, 0.33], 'plaster');
      }
    }
  }
  // 外墙上段：每开间一樘高窗（腰檐以上、檐下）
  const hi = 12.6, wh = 1.9;
  for (const [z0, z1] of [[159.6, 163.2], [163.6, 167.2], [167.6, 171.2], [171.6, 175.2]]) {
    const zc = (z0 + z1) / 2;
    lattice(kit, [218, hi, zc - 0.85], [218, hi, zc + 0.85], wh, { sill: 0.05, inset: -0.1, spacing: 0.15 });
    lattice(kit, [201.5, hi, zc + 0.85], [201.5, hi, zc - 0.85], wh, { sill: 0.05, inset: -0.1, spacing: 0.15 });
  }
  for (const [x0, x1] of [[202.4, 206.0], [206.4, 209.8], [210.2, 213.1], [213.5, 217.4]]) {
    const xc = (x0 + x1) / 2;
    lattice(kit, [xc - 0.85, hi, 159], [xc + 0.85, hi, 159], wh, { sill: 0.05, inset: -0.1, spacing: 0.15 });
  }

  // ── 正面四根檐柱 + 阑额 + 普拍枋 + 斗拱 ──
  for (const x of STATUE_COLS) post(kit, x, FRONT_Z, top, ARCH_UNDER, COL_R, { collide: '坐像殿 檐柱' });
  kit.beam([H.x0 - 0.1, ARCH_UNDER + 0.25, FRONT_Z], [H.x1 + 0.1, ARCH_UNDER + 0.25, FRONT_Z], 0.36, 0.5, PAL.beamRed);
  kit.beam([H.x0 - 0.2, ARCH_UNDER + 0.55, FRONT_Z], [H.x1 + 0.2, ARCH_UNDER + 0.55, FRONT_Z], 0.5, 0.1, PAL.beam);
  // 额枋上的七朱八白（土朱底上一排白块，唐宋阑额的做法）
  for (let i = 0; i < 8; i++) {
    const x = H.x0 + 0.6 + ((H.x1 - H.x0 - 1.2) * (i + 0.5)) / 8;
    kit.box([x, ARCH_UNDER + 0.25, FRONT_Z + 0.185], [0.9, 0.2, 0.02], PAL.plaster, 'plaster');
  }
  const bBase = ARCH_UNDER + 0.6, BS = 0.64;
  const bxs = [...STATUE_COLS, (206.2 + 213.3) / 2 - 1.8, (206.2 + 213.3) / 2 + 1.8, 204.1, 215.45];
  for (const x of bxs) bracket(kit, x, bBase, FRONT_Z, [0, 1], BS, { tiers: 1 });
  for (const x of [...STATUE_COLS, 204.1, 210.0, 215.45]) bracket(kit, x, bBase, 159.4, [0, -1], BS, { tiers: 1 });
  for (const z of [159.4, 163.4, 167.4, 171.4, FRONT_Z]) {
    bracket(kit, 201.9, bBase, z, [-1, 0], BS, { tiers: 1 });
    bracket(kit, 217.6, bBase, z, [1, 0], BS, { tiers: 1 });
  }

  // ── 匾：明间额上，往前微倾 ──
  {
    kit.box([209.75, 15.65, FRONT_Z + 0.42], [3.3, 1.0, 0.12], PAL.gold);
    kit.box([209.75, 15.65, FRONT_Z + 0.49], [3.0, 0.8, 0.04], shade(PAL.teal, 0.55));
    for (const dx of [-0.95, 0, 0.95]) kit.box([209.75 + dx, 15.65, FRONT_Z + 0.52], [0.5, 0.5, 0.02], PAL.gold);
  }

  // ── 殿内平棋天花（像顶 13.72 以上、檐下）──
  const ceilY = 16.3;
  kit.box([209.75, ceilY, 167.45], [15.0, 0.08, 15.6], PAL.timberDark, 'paint', { bottom: shade(PAL.timberDark, 0.8) });
  for (let x = 202.8; x < 217; x += 1.5) kit.box([x, ceilY - 0.08, 167.45], [0.12, 0.12, 15.6], PAL.beamRed);
  for (let z = 160.3; z < 175.3; z += 1.5) kit.box([209.75, ceilY - 0.08, z], [15.0, 0.12, 0.12], PAL.beamRed);

  // ── 屋顶：歇山 + 两山和后檐的腰檐（重檐）──
  roof(kit, MAIN_ROOF);
  pentRoof(kit, { x0: H.x0, x1: H.x1, z0: H.z0, z1: FRONT_Z, top: 12.0, eave: 10.5, out: 2.0, sides: { n: true, e: true, w: true }, endExt: 0.55 });
  // 腰檐下的一排小斗拱（托着腰檐）
  for (const z of [161.4, 165.4, 169.4, 173.4]) {
    bracket(kit, 201.5, 11.0, z, [-1, 0], 0.42, { tiers: 1 });
    bracket(kit, 218.0, 11.0, z, [1, 0], 0.42, { tiers: 1 });
  }
  for (const x of [204.1, 208.1, 212.1, 216.1]) bracket(kit, x, 11.0, 159.0, [0, -1], 0.42, { tiers: 1 });
  // 屋顶（檐下以上）实心：挡子弹
  kit.collide([209.75, (15.6 + 19.5) / 2, 167.5], [H.x1 - H.x0, 19.5 - 15.6, H.z1 - H.z0], '坐像殿 屋顶');

  // ── 幡：两次间各一面（明间留空给坐像） ──
  for (const [x, ph] of [[204.1, 0.0], [215.45, 1.9]] as [number, number][]) {
    kit.banner([x, ARCH_UNDER - 0.08, FRONT_Z + 0.05], 1.25, 8.6, 90, { phase: ph, amp: 0.3 });
  }
  return kit.build();
}

export const REDO_BUILDERS: Record<string, (ctx: PieceContext, req: PieceRequest) => BuiltPiece> = {
  坐像殿: ctx => buildStatueHall(ctx),
};

export const LAB: LabPiece[] = [
  {
    id: 'statue-hall',
    title: '坐像殿',
    note: '1-3 寺院前庭北面：正面敞开罩住坐像（检视页另摆了坐像和 1.72 m 台基做参照）；前庭视线过正面约 11.5 m',
    async build(ctx) {
      const built = buildStatueHall(ctx);
      // 检视页参照：坐像（已有资产 × 0.6，像顶 13.72）+ 台基
      const lab = new Kit(ctx, '参照');
      lab.box([210, 0.86, 169], [13.4, 1.72, 12], PAL.stoneDark, 'stone');
      built.object.add(lab.build().object);
      try {
        const statue = await loadPropGlb('SM_Tripo_DesertSeatedColossus', ctx);
        statue.scale.setScalar(0.6);
        statue.position.set(210, 1.72, 169);
        built.object.add(statue);
      } catch (err) {
        console.warn('[statueHall] 坐像参照没加载上', err);
      }
      return built;
    },
    views: [
      { name: 'forecourt', eye: [212, 1.6, 208], look: [210, 11, 169], fov: 60 },
      { name: 'front-mid', eye: [196, 9, 214], look: [210, 11, 167], fov: 55 },
      { name: 'threshold', eye: [209, 1.6, 181], look: [210, 9, 166], fov: 75 },
      { name: 'side-east', eye: [238, 5, 192], look: [210, 11, 166], fov: 55 },
      { name: 'sightline-2', eye: [214, 1.6, 115], look: [230, 22.2, 246], fov: 60 },
      { name: 'far', eye: [262, 32, 285], look: [210, 12, 168], fov: 40 },
    ],
  },
];
