import type { PieceRequest } from '../redo/compile';
import { WB_1_A } from '../whitebox/maps/1-A';
import { Kit, PAL, bracket, finial, lattice, loadPropGlb, pentRoof, post, roof, shade, type RGB } from './timber';
import { labTerrainPatch } from './timberStairs';
import type { BuiltPiece, LabPiece, PieceContext, V3 } from './types';

/**
 * 九层楼（1-A 千佛崖的地标）：莫高窟北大像外那座贴崖九层木构楼阁的立面。看得见走不到——50–250 m 外看剪影和层檐节奏，只有脚下的敞厅能进。
 *   崖面约在 z 101（崖顶 18），+8 m 的窟檐层在楼前 z 101–120。体量（中轴 x 215）：
 *     下段 x 201–229、z 94–108，从窟檐层 8 m 起到 25：两翼实心，正中 9.6 m 一间从 8 到 25 敞开，露出龛里的坐像（已有资产，另摆）；
 *     上段 22 × 11（x 204–226、z 95–106）到 32，顶上 14 × 8 的位置是最大的一层歇山顶（檐 31.8、脊 35）。
 *   九重檐：下段五道腰檐（11 / 14 / 17 / 20 / 23，明间断开）+ 下段顶上一圈平座檐（24.9）+ 上段两道腰檐（28.2 / 30.2）+ 顶层歇山。
 *   楼前崖脚一座敞厅（x 200–230、z 120–132）：八根柱 r 0.6，人从柱间穿过；低檐歇山（檐 5.8、脊 7.2，不挡窟檐层垛墙往广场俯射）。
 */

const CX = 215;
const LOW = { x0: 201, x1: 229, z0: 94, z1: 108, y0: 8, y1: 25 };
const BAY = { x0: 210.2, x1: 219.8 };
const UP = { x0: 204, x1: 226, z0: 95, z1: 106, y1: 31.9 };
const CLIFF_TOP = 18, CLIFF_Z = 101;
export const OPEN_HALL_XS = [203, 211, 219, 227];
export const OPEN_HALL_ZS = [122, 130];

/** 一段立面：墙面 + 红柱 + 窗；a→b 沿墙（外侧在 a→b 的左手），只画 y0..y1 */
function facade(kit: Kit, a: [number, number], b: [number, number], y0: number, y1: number, o: { span?: number; windows?: boolean } = {}): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 0.5 || y1 - y0 < 0.4) return;
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
  // 外法线 = 右手（a→b 顺着走，墙在左手边 = 外面在右手）
  const nx = -uz, nz = ux;
  const yaw = (Math.atan2(-uz, ux) * 180) / Math.PI;
  const P = (t: number, y: number, n: number): V3 => [a[0] + ux * t + nx * n, y, a[1] + uz * t + nz * n];
  kit.boxYaw(P(len / 2, (y0 + y1) / 2, -0.15), [len, y1 - y0, 0.3], yaw, PAL.plaster, 'plaster');
  const n = Math.max(1, Math.round(len / (o.span ?? 2.4)));
  for (let i = 0; i <= n; i++) kit.boxYaw(P((len * i) / n, (y0 + y1) / 2, 0.06), [0.34, y1 - y0, 0.2], yaw, PAL.lacquer);
  // 额枋
  kit.boxYaw(P(len / 2, y1 - 0.18, 0.08), [len, 0.3, 0.2], yaw, PAL.beamRed);
  if (o.windows !== false && y1 - y0 > 1.4) {
    // 每开间一樘直棂窗：下面土红槛墙、上面留一道赭白栱眼壁；窗纸是暗赭（远看是红棂格，不是黑窟窿）
    const wTop = y1 - 0.42;
    for (let i = 0; i < n; i++) {
      const t0 = (len * i) / n + 0.17, t1 = (len * (i + 1)) / n - 0.17;
      if (t1 - t0 < 0.6) continue;
      const pa = P(t0, 0, 0), pb = P(t1, 0, 0);
      lattice(kit, [pa[0], y0, pa[2]], [pb[0], y0, pb[2]], wTop - y0, { sill: Math.min(0.5, (wTop - y0) * 0.25), inset: 0, spacing: 0.24, back: [0.6, 0.47, 0.33] });
    }
  }
}

/** 檐下斗拱带：一道枋 + 一排斗（远看是一行节奏点），每隔一个出一朵简化斗拱 */
function frieze(kit: Kit, a: [number, number], b: [number, number], y: number, full = false): void {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ux = (b[0] - a[0]) / len, uz = (b[1] - a[1]) / len;
  const nx = -uz, nz = ux, yaw = (Math.atan2(-uz, ux) * 180) / Math.PI;
  kit.boxYaw([(a[0] + b[0]) / 2 + nx * 0.12, y, (a[1] + b[1]) / 2 + nz * 0.12], [len, 0.16, 0.26], yaw, PAL.beam);
  const n = Math.max(1, Math.round(len / 1.2));
  for (let i = 0; i <= n; i++) {
    const t = (len * i) / n, x = a[0] + ux * t, z = a[1] + uz * t;
    if (full && i % 2 === 0) bracket(kit, x, y + 0.08, z, [nx, nz], 0.42, { tiers: 1 });
    else kit.boxYaw([x + nx * 0.25, y + 0.2, z + nz * 0.25], [0.28, 0.22, 0.3], yaw, PAL.bracketBlock);
  }
}

export function buildNineStorey(ctx: PieceContext): BuiltPiece {
  const kit = new Kit(ctx, '九层楼');

  // ── 下段两翼（实心）：墙芯 + 各层立面 ──
  const wings: [number, number][] = [[LOW.x0, BAY.x0], [BAY.x1, LOW.x1]];
  for (const [x0, x1] of wings) {
    kit.box([(x0 + x1) / 2, (LOW.y0 + LOW.y1) / 2, (LOW.z0 + LOW.z1) / 2], [x1 - x0, LOW.y1 - LOW.y0, LOW.z1 - LOW.z0], shade(PAL.plaster, 0.92), 'plaster');
    kit.collide([(x0 + x1) / 2, (LOW.y0 + LOW.y1) / 2, (LOW.z0 + LOW.z1) / 2], [x1 - x0, LOW.y1 - LOW.y0, LOW.z1 - LOW.z0], '九层楼 下段');
  }
  // 楼前台明（窟檐层上）
  kit.box([CX, LOW.y0 + 0.15, LOW.z1 + 0.6], [LOW.x1 - LOW.x0 + 1.2, 0.5, 1.6], PAL.stone, 'stone', { skipBottom: true });
  const eavesLow = [11, 14, 17, 20, 23];
  for (let k = 0; k <= eavesLow.length; k++) {
    const y0 = k === 0 ? LOW.y0 + 0.4 : eavesLow[k - 1] + 1.0;
    const top = k < eavesLow.length ? eavesLow[k] - 0.15 : LOW.y1;
    // 正面两翼
    facade(kit, [LOW.x0, LOW.z1], [BAY.x0, LOW.z1], y0, top);
    facade(kit, [BAY.x1, LOW.z1], [LOW.x1, LOW.z1], y0, top);
    // 两山（崖顶以下只露出崖面以外的那段）
    const zIn = top <= CLIFF_TOP ? CLIFF_Z : LOW.z0;
    facade(kit, [LOW.x0, zIn], [LOW.x0, LOW.z1], y0, top, { span: 2.3 });
    facade(kit, [LOW.x1, LOW.z1], [LOW.x1, zIn], y0, top, { span: 2.3 });
    // 背面：崖顶以上才看得见
    if (top > CLIFF_TOP) facade(kit, [LOW.x1, LOW.z0], [LOW.x0, LOW.z0], Math.max(y0, CLIFF_TOP), top, { span: 2.8, windows: false });
    if (k < eavesLow.length) {
      const e = eavesLow[k];
      frieze(kit, [LOW.x0, LOW.z1], [BAY.x0, LOW.z1], e + 0.3);
      frieze(kit, [BAY.x1, LOW.z1], [LOW.x1, LOW.z1], e + 0.3);
      pentRoof(kit, {
        x0: LOW.x0, x1: LOW.x1, z0: LOW.z0, z1: LOW.z1, top: e + 1.0, eave: e, out: 1.8, sides: { n: true, e: true, s: true, w: true },
        lift: 0.5, flare: 0.3, thick: 0.16, res: 0.6, rafterOut: 0,
        hole: (x, z) => z > LOW.z1 - 0.2 && x > BAY.x0 + 0.05 && x < BAY.x1 - 0.05,
      });
    }
  }
  // ── 明间：通高敞开的龛，两根通柱 + 额 ──
  for (const x of [BAY.x0 + 0.25, BAY.x1 - 0.25]) post(kit, x, LOW.z1 - 0.3, LOW.y0, LOW.y1, 0.42, { collide: '九层楼 明间柱' });
  kit.box([CX, LOW.y1 + 0.25, LOW.z1 - 0.3], [BAY.x1 - BAY.x0 + 0.8, 0.5, 0.5], PAL.beamRed);
  for (const x of [CX - 3.2, CX, CX + 3.2]) bracket(kit, x, LOW.y1 + 0.5, LOW.z1 - 0.3, [0, 1], 0.5, { tiers: 1 });
  // 龛壁（两翼的里侧 + 龛底）：暗赭壁画
  for (const x of [BAY.x0 + 0.02, BAY.x1 - 0.02]) kit.box([x, (LOW.y0 + LOW.y1) / 2, (99 + LOW.z1) / 2], [0.06, LOW.y1 - LOW.y0, LOW.z1 - 99], [0.36, 0.22, 0.16], 'plaster');
  kit.box([CX, (LOW.y0 + LOW.y1) / 2, 99], [BAY.x1 - BAY.x0, LOW.y1 - LOW.y0, 0.3], [0.3, 0.19, 0.14], 'plaster');
  kit.box([CX, 26.0, (99 + LOW.z1) / 2], [BAY.x1 - BAY.x0, 0.3, LOW.z1 - 99], shade(PAL.timberDark, 0.9));
  // 龛顶上方：上段墙面露出来的一截压暗，额上挂匾
  kit.box([CX, 26.6, UP.z1 + 0.06], [BAY.x1 - BAY.x0 + 0.4, 1.3, 0.1], PAL.timberDark);
  kit.box([CX, 25.35, LOW.z1 + 0.02], [3.4, 0.62, 0.1], PAL.gold);
  kit.box([CX, 25.35, LOW.z1 + 0.08], [3.1, 0.46, 0.04], shade(PAL.teal, 0.55));

  // ── 下段顶上一圈平座檐（第六重）+ 檐下斗拱带 ──
  frieze(kit, [LOW.x0, LOW.z1], [LOW.x1, LOW.z1], LOW.y1 + 0.12, true);
  pentRoof(kit, { x0: UP.x0, x1: UP.x1, z0: UP.z0, z1: UP.z1, top: 27.1, eave: 24.9, out: 4.2, sides: { n: true, e: true, s: true, w: true }, lift: 0.8, flare: 0.5, res: 0.7, rafterOut: 0 });

  // ── 上段：墙 + 两道腰檐（第七、八重）──
  kit.box([CX, (LOW.y1 + UP.y1) / 2, (UP.z0 + UP.z1) / 2], [UP.x1 - UP.x0, UP.y1 - LOW.y1, UP.z1 - UP.z0], shade(PAL.plaster, 0.92), 'plaster');
  kit.collide([CX, (LOW.y1 + UP.y1) / 2, (UP.z0 + UP.z1) / 2], [UP.x1 - UP.x0, UP.y1 - LOW.y1, UP.z1 - UP.z0], '九层楼 上段');
  const upBands: [number, number][] = [[27.1, 28.2], [29.0, 30.2], [31.0, UP.y1]];
  for (const [y0, y1] of upBands) {
    facade(kit, [UP.x0, UP.z1], [UP.x1, UP.z1], y0, y1, { span: 2.2 });
    facade(kit, [UP.x0, UP.z0], [UP.x0, UP.z1], y0, y1, { span: 2.2 });
    facade(kit, [UP.x1, UP.z1], [UP.x1, UP.z0], y0, y1, { span: 2.2 });
    facade(kit, [UP.x1, UP.z0], [UP.x0, UP.z0], y0, y1, { span: 2.2, windows: false });
  }
  for (const e of [28.2, 30.2]) {
    frieze(kit, [UP.x0, UP.z1], [UP.x1, UP.z1], e + 0.12);
    pentRoof(kit, { x0: UP.x0, x1: UP.x1, z0: UP.z0, z1: UP.z1, top: e + 0.8, eave: e, out: 1.25, sides: { n: true, e: true, s: true, w: true }, lift: 0.45, flare: 0.28, thick: 0.15, res: 0.6, rafterOut: 0 });
  }
  frieze(kit, [UP.x0, UP.z1], [UP.x1, UP.z1], 31.35, true);
  frieze(kit, [UP.x0, UP.z0], [UP.x0, UP.z1], 31.35);
  frieze(kit, [UP.x1, UP.z1], [UP.x1, UP.z0], 31.35);

  // ── 顶层歇山（第九重，最大最翘）+ 宝顶 ──
  roof(kit, { x: CX, z: 100.5, kind: 'xieshan', hx: 11.6, hz: 6.6, eave: 31.8, ridge: 34.5, gableX: 7.2, lift: 1.35, flare: 0.9, liftR: 4.2, curve: 0.45, rafterOut: 1.2, rafterStep: 0.5, chiwei: 1.6, res: 0.6 });
  kit.collide([CX, 33.2, 100.5], [16, 2.4, 9], '九层楼 顶');
  finial(kit, CX, 35.1, 100.5, 2.6);

  // ── 楼前崖脚的敞厅 ──
  openHall(kit);
  return kit.build();
}

function openHall(kit: Kit): void {
  const top = 0.15, colTop = 4.9;
  kit.box([215, top - 0.3, 126], [30.6, 0.6, 12.6], PAL.stone, 'stone', { skipBottom: true, uv: 0.5 });
  kit.collide([215, top - 0.3, 126], [30.6, 0.6, 12.6], '九层楼敞厅 台明');
  for (const x of OPEN_HALL_XS) for (const z of OPEN_HALL_ZS) post(kit, x, z, top, colTop, 0.6, { collide: '九层楼敞厅 柱' });
  for (const z of OPEN_HALL_ZS) kit.beam([200.2, colTop - 0.25, z], [229.8, colTop - 0.25, z], 0.4, 0.5, PAL.beamRed);
  for (const x of OPEN_HALL_XS) kit.beam([x, colTop - 0.1, 120.6], [x, colTop - 0.1, 131.4], 0.42, 0.5, PAL.beam);
  for (const x of OPEN_HALL_XS) {
    bracket(kit, x, colTop, 130, [0, 1], 0.7, { tiers: 1 });
    bracket(kit, x, colTop, 122, [0, -1], 0.7, { tiers: 1 });
  }
  for (let i = 0; i < 3; i++) bracket(kit, (OPEN_HALL_XS[i] + OPEN_HALL_XS[i + 1]) / 2, colTop, 130, [0, 1], 0.7, { tiers: 1 });
  for (const z of OPEN_HALL_ZS) {
    bracket(kit, 203, colTop, z, [-1, 0], 0.7, { tiers: 1 });
    bracket(kit, 227, colTop, z, [1, 0], 0.7, { tiers: 1 });
  }
  // 平棋天花
  kit.box([215, 5.7, 126], [26, 0.08, 9.2], PAL.timberDark, 'paint', { bottom: shade(PAL.timberDark, 0.8) });
  roof(kit, { x: 215, z: 126, kind: 'xieshan', hx: 16.0, hz: 7.0, eave: 5.85, ridge: 7.2, gableX: 11.5, lift: 0.6, flare: 0.4, liftR: 3, curve: 0.6, rafterOut: 2.2, ridgeH: 0.38, ridgeW: 0.34, chiwei: 0.6 });
  kit.collide([215, 6.4, 126], [30, 1.0, 12], '九层楼敞厅 屋顶');
  // 正中一块匾
  kit.box([215, 5.15, 130.35], [3.0, 0.7, 0.1], PAL.gold);
  kit.box([215, 5.15, 130.42], [2.7, 0.52, 0.04], shade(PAL.teal, 0.55) as RGB);
}

export const REDO_BUILDERS: Record<string, (ctx: PieceContext, req: PieceRequest) => BuiltPiece> = {
  九层楼: ctx => buildNineStorey(ctx),
};

export const LAB: LabPiece[] = [
  {
    id: 'nine-storey',
    title: '九层楼',
    note: '1-A 千佛崖地标：贴崖九重檐立面（下段明间露坐像，另摆）+ 崖脚敞厅；检视页垫了白盒地形（崖、窟檐层）和坐像参照',
    async build(ctx) {
      const built = buildNineStorey(ctx);
      built.object.add(labTerrainPatch(WB_1_A, 170, 262, 70, 150, 1));
      try {
        const statue = await loadPropGlb('SM_Tripo_DesertSeatedColossus', ctx);
        statue.scale.setScalar(0.85);
        statue.position.set(215, 8, 103.2);
        built.object.add(statue);
      } catch (err) {
        console.warn('[nineStorey] 坐像参照没加载上', err);
      }
      return built;
    },
    views: [
      { name: 'spawn', eye: [165, 3.2, 256], look: [214, 20, 101], fov: 45 },
      { name: 'river', eye: [250, 2.0, 205], look: [215, 18, 104], fov: 50 },
      { name: 'plaza', eye: [215, 1.6, 152], look: [215, 15, 106], fov: 70 },
      { name: 'hall-walk', eye: [196, 1.6, 126], look: [232, 3.2, 126], fov: 70 },
      { name: 'terrace', eye: [200, 9.6, 117], look: [215, 18, 104], fov: 70 },
      { name: 'oblique', eye: [262, 30, 175], look: [215, 18, 104], fov: 45 },
      { name: 'cliff-top', eye: [182, 19.6, 60], look: [215, 27, 100], fov: 55 },
    ],
  },
];
