import type { PieceRequest } from '../redo/compile';
import { Kit, PAL, bracket, deck, hash01, lattice, pentRoof, post, railing, roof, roofHeightAt, stairRun, type RoofOpts } from './timber';
import type { BuiltPiece, LabPiece, PieceContext, V3 } from './types';

/**
 * 月泉阁（1-4 鸣沙山月牙泉 · 首领场，南岸）：两层木构楼阁 + 东侧长廊 + 东头门楼 + 上二层的木梯。程序化木构，坐标即游戏坐标。
 *   敞厅 x 151–169、z 150.5–164.2：底层只有 12 根柱（环线沿 z ≈ 160.2 从中跨穿过，两排柱之间净宽 6.4 m），
 *     二层楼面 5.9（底 5.5）：北半露天平座（勾栏 1.1 m，俯射位），南半是直棂窗围的上层屋，歇山顶（檐 9、脊 13.2），东三分之一塌了。
 *     平座下一圈腰檐（北、西、南三面；东面接长廊和木梯）。
 *   木梯：中线 z 154，x 182（地面）往西升到 x 170.5（5.9），宽 3 m，北侧扶手；x 169–170.5 一段平台接楼面。
 *   长廊 x 169–196：两排柱 z 156.7 / 163.7（r 0.25），两面敞开，两坡顶（檐 3.6、脊 6）。
 *   东门楼 x 196–203：四个 1.2 m 方墩、南北两面实墙，东西向门洞净宽 7.4 m，庑殿顶（檐 5.2、脊 9）。
 */

export const HALL_XS = [151.5, 157.3, 162.7, 168.5];
export const HALL_ZS = [151, 156.7, 163.7];
export const GALLERY_XS = [173.5, 178, 182.5, 187, 191.5];
export const GALLERY_ZS = [156.7, 163.7];
export const GATE_PIERS: [number, number][] = [[196.6, 156.1], [202.4, 156.1], [196.6, 164.3], [202.4, 164.3]];
const HALL = { x0: 151, x1: 169, z0: 150.5, z1: 164.2 };
const FLOOR = 5.9, FLOOR_UNDER = 5.5;
/** 上层屋（南半）：柱网 z 156.7–163.7 */
const ROOM = { x0: 151.5, x1: 168.5, z0: 156.7, z1: 163.7 };
const UPPER_ROOF: RoofOpts = {
  x: 160, z: 160.2, kind: 'xieshan', hx: 10.5, hz: 5.5, eave: 9.0, ridge: 12.6,
  gableX: 7.75, lift: 0.75, flare: 0.5, rafterOut: 2.0,
};

/** 塌顶：东三分之一，边缘参差；檐口还挂着几段 */
function collapsed(x: number, z: number): boolean {
  const edge = 164.4 + 0.9 * Math.sin(z * 2.3) + 0.55 * Math.sin(z * 5.1 + 1.0) + (hash01(Math.floor(z * 1.6) * 31 + 7) - 0.5) * 0.8;
  if (x < edge) return false;
  const nearEave = Math.min(Math.abs(z - 154.7), Math.abs(z - 165.7), Math.abs(x - 170.5));
  if (nearEave < 0.6 && hash01(Math.floor(x * 1.5) * 131 + Math.floor(z * 1.5) * 17) > 0.4) return false;
  // 东头山面下段残存一角
  if (x > 169.2 && z > 161.5 && hash01(Math.floor(z * 2) * 7 + 3) > 0.3) return false;
  return true;
}

export function buildYuequanHall(ctx: PieceContext): BuiltPiece {
  const kit = new Kit(ctx, '月泉阁');
  const g0 = 0;
  const floorTop = g0 + 0.12;

  // ── 台明（齐地的石铺，边 0.12 m）──
  kit.box([(HALL.x0 + HALL.x1) / 2, floorTop - 0.25, (HALL.z0 + HALL.z1) / 2], [HALL.x1 - HALL.x0 + 0.3, 0.5, HALL.z1 - HALL.z0 + 0.3], PAL.stone, 'stone', { skipBottom: true, uv: 0.5 });
  kit.collide([(HALL.x0 + HALL.x1) / 2, floorTop - 0.25, (HALL.z0 + HALL.z1) / 2], [HALL.x1 - HALL.x0 + 0.3, 0.5, HALL.z1 - HALL.z0 + 0.3], '月泉阁 台明');

  // ── 底层：12 根柱 + 阑额 + 平座斗拱 + 楼面 ──
  const colTop = 4.55;
  for (const x of HALL_XS) for (const z of HALL_ZS) post(kit, x, z, floorTop, colTop, 0.3, { collide: '月泉阁 柱' });
  for (const z of HALL_ZS) {
    kit.beam([HALL_XS[0] - 0.35, colTop - 0.2, z], [HALL_XS[3] + 0.35, colTop - 0.2, z], 0.24, 0.4, PAL.beamRed);
  }
  for (const x of HALL_XS) kit.beam([x, colTop - 0.2, HALL_ZS[0] - 0.35], [x, colTop - 0.2, HALL_ZS[2] + 0.35], 0.24, 0.4, PAL.beamRed);
  // 平座斗拱：外圈柱头朝外、补间一朵
  for (const x of HALL_XS) {
    bracket(kit, x, colTop, HALL_ZS[0], [0, -1], 0.6, { tiers: 1 });
    bracket(kit, x, colTop, HALL_ZS[2], [0, 1], 0.6, { tiers: 1 });
  }
  for (const z of HALL_ZS) {
    bracket(kit, HALL_XS[0], colTop, z, [-1, 0], 0.6, { tiers: 1 });
    bracket(kit, HALL_XS[3], colTop, z, [1, 0], 0.6, { tiers: 1 });
  }
  for (let i = 0; i < 3; i++) {
    const xm = (HALL_XS[i] + HALL_XS[i + 1]) / 2;
    bracket(kit, xm, colTop, HALL_ZS[0], [0, -1], 0.6, { tiers: 1 });
    bracket(kit, xm, colTop, HALL_ZS[2], [0, 1], 0.6, { tiers: 1 });
  }
  // 楼面梁（沿 z，压在柱网上）+ 楼板
  for (const x of HALL_XS) kit.beam([x, FLOOR_UNDER - 0.17, HALL.z0 + 0.1], [x, FLOOR_UNDER - 0.17, HALL.z1 - 0.1], 0.3, 0.34, PAL.beam);
  deck(kit, HALL.x0, HALL.x1, HALL.z0, HALL.z1, FLOOR, { grain: 0, joists: 1.1, collide: '月泉阁 二层楼面' });
  // 楼面外沿一道雁翅板（平座的封边，土朱）
  for (const [a, b] of [[[HALL.x0, HALL.z0], [HALL.x1, HALL.z0]], [[HALL.x0, HALL.z1], [HALL.x1, HALL.z1]], [[HALL.x0, HALL.z0], [HALL.x0, HALL.z1]], [[HALL.x1, HALL.z0], [HALL.x1, HALL.z1]]] as [number, number][][]) {
    const out = a[0] === b[0] ? [Math.sign(a[0] - 160) * 0.04, 0] : [0, Math.sign(a[1] - 157.35) * 0.04];
    kit.beam([a[0] + out[0], FLOOR - 0.16, a[1] + out[1]], [b[0] + out[0], FLOOR - 0.16, b[1] + out[1]], 0.06, 0.32, PAL.beamRed);
  }

  // ── 腰檐（平座下，北 / 西 / 南三面）──
  pentRoof(kit, { x0: HALL.x0, x1: HALL.x1, z0: HALL.z0, z1: HALL.z1, top: FLOOR_UNDER - 0.08, eave: 4.45, out: 1.7, sides: { n: true, w: true, s: true }, endExt: 0 });

  // ── 二层平座勾栏（北半露天：北沿、西沿、东沿让出木梯口；南半屋外一圈窄平座也围上）──
  const rail = (a: [number, number], b: [number, number], name = '月泉阁 平座勾栏'): void => railing(kit, [a[0], FLOOR, a[1]], [b[0], FLOOR, b[1]], { h: 1.1, collide: name });
  const e = 0.1;
  rail([HALL.x0 + e, HALL.z0 + e], [HALL.x1 - e, HALL.z0 + e]);
  rail([HALL.x0 + e, HALL.z0 + e], [HALL.x0 + e, HALL.z1 - e]);
  rail([HALL.x0 + e, HALL.z1 - e], [HALL.x1 - e, HALL.z1 - e]);
  rail([HALL.x1 - e, HALL.z0 + e], [HALL.x1 - e, 152.5]);
  rail([HALL.x1 - e, 155.5], [HALL.x1 - e, HALL.z1 - e]);

  // ── 上层屋：8 根柱 + 直棂窗 / 格扇门 + 阑额 + 斗拱 ──
  const upTop = 8.35;
  const upXs = HALL_XS, upZs = [ROOM.z0, ROOM.z1], BS = 0.62;
  for (const x of upXs) for (const z of upZs) post(kit, x, z, FLOOR, upTop, 0.27, { plinth: false });
  post(kit, ROOM.x0, 160.2, FLOOR, upTop, 0.22, { plinth: false });
  post(kit, ROOM.x1, 160.2, FLOOR, upTop, 0.22, { plinth: false });
  const wallH = upTop - 0.32 - FLOOR;
  for (let i = 0; i < 3; i++) {
    const x0 = upXs[i] + 0.27, x1 = upXs[i + 1] - 0.27;
    const broken = i === 2;
    lattice(kit, [x0, FLOOR, ROOM.z0], [x1, FLOOR, ROOM.z0], wallH, { kind: i === 1 ? 'door' : 'window', inset: 0.05, spacing: broken ? 0.34 : 0.17 });
    lattice(kit, [x1, FLOOR, ROOM.z1], [x0, FLOOR, ROOM.z1], wallH, { kind: 'window', inset: 0.05, spacing: broken ? 0.3 : 0.17 });
  }
  for (const [x, sgn] of [[ROOM.x0, 1], [ROOM.x1, -1]] as const) {
    lattice(kit, [x, FLOOR, ROOM.z1 - 0.27], [x, FLOOR, 160.2 + 0.22], wallH, { kind: 'window', inset: 0.05 * sgn, spacing: x > 160 ? 0.32 : 0.17 });
    lattice(kit, [x, FLOOR, 160.2 - 0.22], [x, FLOOR, ROOM.z0 + 0.27], wallH, { kind: 'window', inset: 0.05 * sgn, spacing: x > 160 ? 0.32 : 0.17 });
  }
  // 上层屋：实心（走不进去，挡子弹）
  kit.collide([(ROOM.x0 + ROOM.x1) / 2, (FLOOR + 9.7) / 2, (ROOM.z0 + ROOM.z1) / 2], [ROOM.x1 - ROOM.x0 + 0.5, 9.7 - FLOOR, ROOM.z1 - ROOM.z0 + 0.5], '月泉阁 上层屋');
  kit.collide([(ROOM.x0 + 164) / 2, 10.9, (ROOM.z0 + ROOM.z1) / 2], [164 - ROOM.x0, 2.4, ROOM.z1 - ROOM.z0], '月泉阁 屋顶');
  for (const z of upZs) kit.beam([ROOM.x0 - 0.4, upTop - 0.16, z], [ROOM.x1 + 0.4, upTop - 0.16, z], 0.22, 0.34, PAL.beamRed);
  for (const x of [ROOM.x0, ROOM.x1]) kit.beam([x, upTop - 0.16, ROOM.z0 - 0.4], [x, upTop - 0.16, ROOM.z1 + 0.4], 0.22, 0.34, PAL.beamRed);
  // 普拍枋 + 柱头 / 补间斗拱（东头几朵塌了）
  for (const z of upZs) kit.beam([ROOM.x0 - 0.5, upTop + 0.04, z], [ROOM.x1 + 0.5, upTop + 0.04, z], 0.3, 0.08, PAL.beam);
  const bx = [...upXs, ...[0, 1, 2].map(i => (upXs[i] + upXs[i + 1]) / 2)];
  for (const x of bx) {
    if (x > 165 && x < 168) continue;
    bracket(kit, x, upTop + 0.08, ROOM.z0, [0, -1], BS);
    bracket(kit, x, upTop + 0.08, ROOM.z1, [0, 1], BS);
  }
  for (const z of [ROOM.z0, 160.2, ROOM.z1]) {
    bracket(kit, ROOM.x0, upTop + 0.08, z, [-1, 0], BS);
    if (z !== 160.2) bracket(kit, ROOM.x1, upTop + 0.08, z, [1, 0], BS);
  }
  // 橑檐枋（斗拱外跳托着的檐檩）
  // 橑檐枋：令栱上、贴着屋面底
  const reach = 1.45 * BS, yP = roofHeightAt(UPPER_ROOF, 2.0 - reach) - 0.2 - 0.14;
  for (const z of [ROOM.z0 - reach, ROOM.z1 + reach]) kit.beam([ROOM.x0 - reach, yP, z], [z < 160 ? ROOM.x1 + reach : 165.2, yP, z], 0.16, 0.2, PAL.beam);
  kit.beam([ROOM.x0 - reach, yP, ROOM.z0 - reach], [ROOM.x0 - reach, yP, ROOM.z1 + reach], 0.16, 0.2, PAL.beam);
  // 墙线上的压檐枋（斗拱顶到屋面底之间）
  for (const z of upZs) kit.beam([ROOM.x0 - 0.3, upTop + 0.08 + 1.34 * BS + 0.14, z], [z < 160 ? ROOM.x1 + 0.3 : 165, upTop + 0.08 + 1.34 * BS + 0.14, z], 0.24, 0.28, PAL.beamRed);

  // ── 上层歇山顶（东三分之一塌了）──
  roof(kit, { ...UPPER_ROOF, hole: collapsed, brokenRidge: 1 });
  exposedFrame(kit);

  // ── 木梯 + 平台（北侧扶手）──
  stairRun(kit, [182, g0, 154], [170.5, FLOOR, 154], { width: 3, railR: true, collide: '月泉阁 木梯' });
  deck(kit, 169, 170.5, 152.5, 155.5, FLOOR, { grain: 2, joists: 0, collide: '月泉阁 梯口平台' });
  for (const [x, z] of [[169.25, 152.65], [170.35, 152.65], [169.25, 155.35], [170.35, 155.35]] as [number, number][]) {
    kit.box([x, (g0 + FLOOR_UNDER) / 2, z], [0.22, FLOOR_UNDER - g0 + 0.1, 0.22], PAL.beam, 'paint', { dust: 1, collide: '月泉阁 梯口平台柱' });
  }
  kit.beam([169.25, 2.0, 152.65], [170.35, 4.8, 152.65], 0.08, 0.12, PAL.timberDark);
  kit.beam([169.25, 2.0, 155.35], [170.35, 4.8, 155.35], 0.08, 0.12, PAL.timberDark);
  railing(kit, [169, FLOOR, 152.6], [170.5, FLOOR, 152.6], { h: 1.1, collide: '月泉阁 梯口勾栏' });

  // ── 长廊 ──
  const gTop = 3.0;
  for (const x of GALLERY_XS) for (const z of GALLERY_ZS) post(kit, x, z, g0, gTop, 0.25, { collide: '长廊 柱' });
  for (const z of GALLERY_ZS) kit.beam([168.6, gTop - 0.17, z], [196.0, gTop - 0.17, z], 0.2, 0.34, PAL.beamRed);
  for (const x of GALLERY_XS) {
    kit.beam([x, gTop + 0.12, 156.2], [x, gTop + 0.12, 164.2], 0.22, 0.3, PAL.beam);
    for (const z of GALLERY_ZS) bracket(kit, x, gTop, z, [0, z < 160 ? -1 : 1], 0.48, { tiers: 1 });
  }
  // 脊檩 + 金檩（廊下抬头看得见）
  for (const [z, y] of [[160.2, 5.28], [158.3, 4.22], [162.1, 4.22]] as [number, number][]) kit.beam([169.2, y, z], [194.9, y, z], 0.18, 0.22, PAL.beam);
  for (const x of GALLERY_XS) {
    kit.beam([x, gTop + 0.3, 158.3], [x, 4.12, 158.3], 0.14, 0.14, PAL.beam);
    kit.beam([x, gTop + 0.3, 162.1], [x, 4.12, 162.1], 0.14, 0.14, PAL.beam);
    kit.beam([x, 4.3, 158.4], [x, 5.15, 160.2], 0.12, 0.12, PAL.beam);
    kit.beam([x, 4.3, 162.0], [x, 5.15, 160.2], 0.12, 0.12, PAL.beam);
  }
  roof(kit, { x: (169.2 + 194.9) / 2, z: 160.2, kind: 'gable', hx: (194.9 - 169.2) / 2, hz: 4.3, eave: 3.6, ridge: 5.72, ridgeH: 0.28, ridgeW: 0.32, curve: 0.7, rafterOut: 0.9, rafterStep: 0.45, collideSlopes: '长廊 屋面' });

  // ── 东门楼 ──
  const pierTop = 4.4;
  for (const [x, z] of GATE_PIERS) {
    kit.box([x, (g0 + pierTop) / 2 - 0.1, z], [1.2, pierTop - g0 + 0.2, 1.2], PAL.stone, 'stone', { dust: 0.6, collide: '门楼 墩' });
    kit.box([x, pierTop + 0.06, z], [1.3, 0.12, 1.3], PAL.stoneDark, 'stone');
  }
  for (const z of [156.1, 164.3]) {
    // 墙：石下碱 + 土红灰泥，上面一道木骨
    kit.box([199.5, 0.4, z], [4.6, 0.8 + 0.2, 0.8], PAL.stoneDark, 'stone', { skipBottom: true });
    kit.box([199.5, (0.9 + pierTop) / 2, z], [4.6, pierTop - 0.9, 0.7], PAL.plasterRed, 'plaster');
    kit.box([199.5, pierTop - 0.45, z], [4.62, 0.14, 0.74], PAL.beam);
    kit.box([199.5, 2.2, z], [0.16, 2.6, 0.74], PAL.beam);
    kit.collide([199.5, pierTop / 2, z], [4.6, pierTop, 0.8], '门楼 墙');
  }
  // 门额、檐枋、斗拱
  for (const x of [196.6, 202.4]) {
    kit.beam([x, pierTop + 0.3, 155.5], [x, pierTop + 0.3, 164.9], 0.5, 0.5, PAL.beamRed);
    // 匾：门洞正上方
    kit.box([x + (x < 200 ? -0.29 : 0.29), pierTop + 0.32, 160.2], [0.08, 0.5, 2.4], PAL.beam);
    kit.box([x + (x < 200 ? -0.32 : 0.32), pierTop + 0.32, 160.2], [0.04, 0.38, 2.2], PAL.gold);
  }
  for (const z of [156.1, 164.3]) kit.beam([195.9, pierTop + 0.3, z], [203.1, pierTop + 0.3, z], 0.4, 0.5, PAL.beamRed);
  const gb = pierTop + 0.55;
  for (const [x, z] of GATE_PIERS) {
    bracket(kit, x, gb, z, [x < 199.5 ? -1 : 1, 0], 0.5, { tiers: 1 });
    bracket(kit, x, gb, z, [0, z < 160 ? -1 : 1], 0.5, { tiers: 1 });
  }
  for (const x of [196.6, 202.4]) bracket(kit, x, gb, 160.2, [x < 199.5 ? -1 : 1, 0], 0.5, { tiers: 1 });
  for (const z of [156.1, 164.3]) bracket(kit, 199.5, gb, z, [0, z < 160 ? -1 : 1], 0.5, { tiers: 1 });
  // 门洞顶：平棋天花
  kit.box([199.5, gb + 0.05, 160.2], [5.0, 0.1, 7.6], PAL.timberDark);
  roof(kit, { x: 199.5, z: 160.2, yaw: 90, kind: 'hip', hx: 5.7, hz: 4.5, eave: 5.2, ridge: 8.6, lift: 0.55, flare: 0.35, rafterOut: 1.0, ridgeH: 0.42, ridgeW: 0.34 });
  kit.collide([199.5, (gb + 7.2) / 2, 160.2], [7.0, 7.2 - gb, 9.4], '门楼 屋顶');

  return kit.build();
}

/** 塌顶处露出来的椽子、檩条：有的断了半截、有的垂下来；平座东头地上躺几根断椽（只是看的，不挡路） */
function exposedFrame(kit: Kit): void {
  const R = UPPER_ROOF;
  const zOf = (side: 1 | -1, d: number): number => R.z + side * (R.hz - d);
  const yOf = (d: number): number => roofHeightAt(R, d) - 0.34;
  for (const side of [1, -1] as const) {
    // 檩条（沿 x）
    for (const d of [1.4, 2.8, 4.1, 5.3]) {
      const h = hash01(Math.round(d * 10) * 7 + (side > 0 ? 1 : 2));
      const x1 = 166 + h * 4.3;
      kit.beam([163.6, yOf(d) - 0.05, zOf(side, d)], [x1, yOf(d) - 0.05 - (x1 > 169 ? 0.35 : 0), zOf(side, d)], 0.2, 0.22, PAL.beam);
    }
    // 椽子（顺坡），隔几根缺一根，有的断在半坡
    for (let x = 164.2; x < 170.2; x += 0.62) {
      const h = hash01(Math.round(x * 10) * 13 + (side > 0 ? 5 : 9));
      if (h > 0.72) continue;
      const dEnd = h < 0.35 ? 5.4 : 1.6 + h * 3.2;
      const a: V3 = [x, yOf(0.2) + 0.05, zOf(side, 0.2)], b: V3 = [x + (h - 0.5) * 0.3, yOf(dEnd) + 0.05 - (h > 0.55 ? 0.25 : 0), zOf(side, dEnd)];
      kit.beam(a, b, 0.11, 0.11, PAL.rafter);
    }
  }
  // 东头断下来的一截脊檩斜搭在屋里
  kit.beam([164.5, 12.2, 160.2], [168.5, 9.6, 159.4], 0.24, 0.26, PAL.beam);
  // 平座地上的碎椽、碎瓦
  const debris: [V3, V3][] = [[[164.2, 5.95, 153.1], [166.6, 6.0, 154.0]], [[165.4, 5.95, 155.6], [166.0, 6.02, 153.4]], [[166.8, 5.95, 152.2], [168.2, 5.97, 152.9]]];
  for (const [a, b] of debris) kit.beam(a, b, 0.11, 0.1, PAL.rafter);
  for (let i = 0; i < 9; i++) {
    const x = 163.6 + hash01(i * 3 + 1) * 4.6, z = 151.6 + hash01(i * 5 + 2) * 4.6;
    kit.boxYaw([x, 5.94, z], [0.34, 0.07, 0.22], hash01(i * 11) * 180, PAL.tileDark, 'paint');
  }
}

/** 运行时（REDO_BUILDERS）：月泉阁连木梯一起建，坐标固定 */
export const REDO_BUILDERS: Record<string, (ctx: PieceContext, req: PieceRequest) => BuiltPiece> = {
  月泉阁: ctx => buildYuequanHall(ctx),
};

export const LAB: LabPiece[] = [
  {
    id: 'yuequan-hall',
    title: '月泉阁',
    note: '1-4 南岸：两层敞厅 + 长廊 + 东门楼 + 木梯（环线沿 z 160.2 穿过底层和长廊）',
    build: ctx => buildYuequanHall(ctx),
    views: [
      { name: 'route-west', eye: [145, 1.6, 160.2], look: [175, 2.6, 160.2], fov: 70 },
      { name: 'under-hall', eye: [156, 1.6, 159], look: [162, 4.2, 153], fov: 75 },
      { name: 'gallery', eye: [172, 1.6, 160.2], look: [200, 2.4, 160.2], fov: 70 },
      { name: 'balcony', eye: [160, 7.5, 153.5], look: [158, 4, 125], fov: 70 },
      { name: 'stair', eye: [188, 1.6, 146], look: [172, 4.2, 155], fov: 65 },
      { name: 'mid-nw', eye: [135, 13, 128], look: [168, 5, 158], fov: 55 },
      { name: 'far', eye: [110, 20, 95], look: [172, 6, 158], fov: 45 },
      { name: 'collapse', eye: [180, 15, 144], look: [165, 10, 158], fov: 55 },
      { name: 'courtyard', eye: [166, 1.6, 186], look: [170, 6, 160], fov: 65 },
    ],
  },
];
